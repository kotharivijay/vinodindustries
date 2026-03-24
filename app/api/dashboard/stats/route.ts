import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [greyCount, despatchCount, partyCount, greyByLot, despatchByLot] = await Promise.all([
    prisma.greyEntry.count(),
    prisma.despatchEntry.count(),
    prisma.party.count(),
    prisma.greyEntry.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    prisma.despatchEntry.groupBy({ by: ['lotNo'], _sum: { than: true } }),
  ])

  // Fetch opening balances (carry-forward from last year)
  let obMap = new Map<string, number>()
  try {
    const db = prisma as any
    const obs = await db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } })
    obMap = new Map(obs.map((o: any) => [o.lotNo.toLowerCase(), o.openingThan]))
  } catch {}

  // Compute per-lot balance including opening balance
  const despatchMap = new Map(despatchByLot.map(d => [d.lotNo, d._sum.than ?? 0]))
  const lotsProcessed = new Set<string>()
  let currentStock = 0
  let totalDespatched = 0

  // Lots with grey entries this year
  for (const g of greyByLot) {
    const key = g.lotNo.toLowerCase()
    lotsProcessed.add(key)
    const ob = obMap.get(key) ?? 0
    const desp = despatchMap.get(g.lotNo) ?? 0
    totalDespatched += desp
    const balance = ob + (g._sum.than ?? 0) - desp
    if (balance > 0) currentStock += balance
  }

  // Lots with only opening balance (no current year grey)
  for (const [lotKey, ob] of obMap) {
    if (lotsProcessed.has(lotKey)) continue
    // Find despatch for this lot (case-insensitive match)
    let desp = 0
    for (const [lotNo, than] of despatchMap) {
      if (lotNo.toLowerCase() === lotKey) { desp = than; break }
    }
    totalDespatched += desp
    const balance = ob - desp
    if (balance > 0) currentStock += balance
  }

  return NextResponse.json({
    greyEntries: greyCount,
    despatchEntries: despatchCount,
    totalDespatched,
    currentStock,
    parties: partyCount,
    openingBalanceLots: obMap.size,
  })
}
