export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * GET /api/maintenance/negative-lots
 *
 * Lots whose total commitments exceed inflow:
 *   inflow   = grey + ob + repro
 *   consumed = max(despatched, foldProgrammed + standaloneDye)
 *   net      = inflow - consumed; rows with net < 0 are returned.
 *
 * Same heuristic used in /api/stock and /api/fold/validate after we
 * stopped double-counting downstream despatch.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [grey, ob, despP, despC, fold, dye, repro] = await Promise.all([
    prisma.greyEntry.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } }),
    prisma.despatchEntry.groupBy({ where: { despatchLots: { none: {} } }, by: ['lotNo'], _sum: { than: true } }),
    prisma.despatchEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    db.foldBatchLot.findMany({
      where: { foldBatch: { cancelled: false } },
      include: { foldBatch: { include: { foldProgram: { select: { foldNo: true } } } } },
    }),
    db.dyeingEntryLot.findMany({ select: { lotNo: true, than: true, entry: { select: { foldBatchId: true } } } }),
    db.reProcessLot.findMany({ where: { status: { in: ['pending', 'in-dyeing', 'finished'] } }, select: { reproNo: true, totalThan: true } }),
  ])

  type Casing = { lotNo: string; than: number }
  const greyMap = new Map<string, Casing>(grey.map((g: any) => [g.lotNo.toLowerCase().trim(), { lotNo: g.lotNo, than: g._sum.than ?? 0 }]))
  const obMap = new Map<string, Casing>(ob.map((o: any) => [o.lotNo.toLowerCase().trim(), { lotNo: o.lotNo, than: o.openingThan ?? 0 }]))
  const reproMap = new Map<string, Casing>(repro.map((r: any) => [r.reproNo.toLowerCase().trim(), { lotNo: r.reproNo, than: r.totalThan ?? 0 }]))

  const despMap = new Map<string, number>()
  for (const d of despP) despMap.set(d.lotNo.toLowerCase().trim(), (despMap.get(d.lotNo.toLowerCase().trim()) || 0) + (d._sum.than ?? 0))
  for (const d of despC) despMap.set(d.lotNo.toLowerCase().trim(), (despMap.get(d.lotNo.toLowerCase().trim()) || 0) + (d._sum.than ?? 0))

  const foldMap = new Map<string, number>()
  const foldDetailMap = new Map<string, string[]>()
  for (const f of fold) {
    const k = f.lotNo.toLowerCase().trim()
    foldMap.set(k, (foldMap.get(k) || 0) + f.than)
    if (!foldDetailMap.has(k)) foldDetailMap.set(k, [])
    foldDetailMap.get(k)!.push(`${f.foldBatch?.foldProgram?.foldNo}/B${f.foldBatch?.batchNo}=${f.than}`)
  }

  const dyeMap = new Map<string, number>()
  for (const d of dye) {
    if (d.entry?.foldBatchId) continue
    const k = d.lotNo.toLowerCase().trim()
    dyeMap.set(k, (dyeMap.get(k) || 0) + d.than)
  }

  const allKeys = new Set<string>([
    ...greyMap.keys(), ...obMap.keys(), ...reproMap.keys(),
    ...despMap.keys(), ...foldMap.keys(), ...dyeMap.keys(),
  ])

  const negatives: any[] = []
  for (const k of allKeys) {
    const inflow = (greyMap.get(k)?.than ?? 0) + (obMap.get(k)?.than ?? 0) + (reproMap.get(k)?.than ?? 0)
    const desp = despMap.get(k) ?? 0
    const folded = foldMap.get(k) ?? 0
    const standDye = dyeMap.get(k) ?? 0
    const consumed = Math.max(desp, folded + standDye)
    const net = inflow - consumed
    if (net < 0) {
      const display = greyMap.get(k)?.lotNo ?? obMap.get(k)?.lotNo ?? reproMap.get(k)?.lotNo ?? k
      negatives.push({
        lotNo: display, inflow, despatched: desp, folded, standaloneDye: standDye,
        consumed, net,
        foldDetail: foldDetailMap.get(k) ?? [],
      })
    }
  }

  negatives.sort((a, b) => a.net - b.net)
  return NextResponse.json({ count: negatives.length, lots: negatives })
}
