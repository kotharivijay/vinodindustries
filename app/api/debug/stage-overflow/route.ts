export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Flags lots where any per-stage total exceeds the lot's grey stock
 * (grey stock = LotOpeningBalance.openingThan + sum(GreyEntry.than)).
 *
 * Used by the NotificationBell to surface data anomalies — typical causes
 * are duplicate finish slips, double-entered despatches, or a missing
 * grey inward row.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  const [
    greyByLot,
    obByLot,
    despatchParent,     // legacy single-lot despatches
    despatchLotByLot,
    dyeLotByLot,
    foldLotByLot,
    finishLotByLot,
    packingLotByLot,
  ] = await Promise.all([
    prisma.greyEntry.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } }),
    prisma.despatchEntry.findMany({
      where: { despatchLots: { none: {} } },
      select: { lotNo: true, than: true },
    }),
    prisma.despatchEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    db.dyeingEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    db.foldBatchLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    db.finishEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    db.packingLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
  ])

  const upper = (s: string) => s.trim().toUpperCase()
  const bump = (m: Map<string, number>, k: string, v?: number | null) =>
    m.set(k, (m.get(k) || 0) + (v || 0))

  const grey = new Map<string, number>()
  for (const g of greyByLot) bump(grey, upper(g.lotNo), g._sum.than)
  const ob = new Map<string, number>()
  for (const o of obByLot) bump(ob, upper(o.lotNo), o.openingThan)

  const desp = new Map<string, number>()
  for (const d of despatchParent) bump(desp, upper(d.lotNo), d.than)
  for (const d of despatchLotByLot) bump(desp, upper(d.lotNo), d._sum.than)

  const dye = new Map<string, number>()
  for (const d of dyeLotByLot) bump(dye, upper(d.lotNo), d._sum.than)
  const fold = new Map<string, number>()
  for (const f of foldLotByLot) bump(fold, upper(f.lotNo), f._sum.than)
  const finish = new Map<string, number>()
  for (const f of finishLotByLot) bump(finish, upper(f.lotNo), f._sum.than)
  const packing = new Map<string, number>()
  for (const p of packingLotByLot) bump(packing, upper(p.lotNo), p._sum.than)

  const allLots = new Set<string>([
    ...grey.keys(), ...ob.keys(), ...desp.keys(),
    ...dye.keys(), ...fold.keys(), ...finish.keys(), ...packing.keys(),
  ])

  const bad: {
    lotNo: string
    stock: number
    grey: number
    ob: number
    overflow: { stage: string; than: number; excess: number }[]
  }[] = []

  for (const lot of allLots) {
    const g = grey.get(lot) || 0
    const o = ob.get(lot) || 0
    const stock = g + o
    if (stock === 0) continue // virtual lots (e.g. RE-PRO) — skip

    const stages: Record<string, number> = {
      despatch: desp.get(lot) || 0,
      dyeing:   dye.get(lot)  || 0,
      fold:     fold.get(lot) || 0,
      finish:   finish.get(lot) || 0,
      packing:  packing.get(lot) || 0,
    }

    const overflow = Object.entries(stages)
      .filter(([, v]) => v > stock)
      .map(([stage, than]) => ({ stage, than, excess: than - stock }))

    if (overflow.length > 0) bad.push({ lotNo: lot, stock, grey: g, ob: o, overflow })
  }

  bad.sort((a, b) =>
    Math.max(...b.overflow.map(o => o.excess)) -
    Math.max(...a.overflow.map(o => o.excess))
  )

  return NextResponse.json(bad)
}
