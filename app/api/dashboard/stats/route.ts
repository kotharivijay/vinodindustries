export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const [greyCount, despatchCount, partyCount, greyByLot, despatchByLot, greyThanAgg, despatchThanAgg, dyeingCount, foldCount] = await Promise.all([
    prisma.greyEntry.count(),
    prisma.despatchEntry.count(),
    prisma.party.count(),
    prisma.greyEntry.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    prisma.despatchEntry.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    prisma.greyEntry.aggregate({ _sum: { than: true } }),
    prisma.despatchEntry.aggregate({ _sum: { than: true } }),
    db.dyeingEntry.count().catch(() => 0),
    db.foldProgram.count().catch(() => 0),
  ])

  // Fetch opening balances (carry-forward from last year)
  let obMap = new Map<string, number>()
  try {
    const obs = await db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } })
    obMap = new Map(obs.map((o: any) => [o.lotNo.toLowerCase(), o.openingThan]))
  } catch {}

  // Compute per-lot balance including opening balance. despatchMap is keyed
  // lower-case: DespatchEntry.lotNo casing can differ from GreyEntry's.
  const despatchMap = new Map<string, number>()
  for (const d of despatchByLot) {
    const k = d.lotNo.toLowerCase()
    despatchMap.set(k, (despatchMap.get(k) || 0) + (d._sum.than ?? 0))
  }
  const lotsProcessed = new Set<string>()
  let currentStock = 0
  let totalDespatched = 0

  // Lots with grey entries this year
  for (const g of greyByLot) {
    const key = g.lotNo.toLowerCase()
    lotsProcessed.add(key)
    const ob = obMap.get(key) ?? 0
    const desp = despatchMap.get(key) ?? 0
    totalDespatched += desp
    const balance = ob + (g._sum.than ?? 0) - desp
    if (balance > 0) currentStock += balance
  }

  // Lots with only opening balance (no current year grey)
  for (const [lotKey, ob] of obMap) {
    if (lotsProcessed.has(lotKey)) continue
    const desp = despatchMap.get(lotKey) ?? 0
    totalDespatched += desp
    const balance = ob - desp
    if (balance > 0) currentStock += balance
  }

  return NextResponse.json({
    greyEntries: greyCount,
    greyThan: greyThanAgg._sum.than ?? 0,
    despatchEntries: despatchCount,
    despatchThan: despatchThanAgg._sum.than ?? 0,
    totalDespatched,
    currentStock,
    parties: partyCount,
    dyeingEntries: dyeingCount,
    foldPrograms: foldCount,
    openingBalanceLots: obMap.size,
    openingThan: Array.from(obMap.values()).reduce((s, v) => s + v, 0),
  })
}
