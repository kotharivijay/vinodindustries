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

  // Compute per-lot balance, sum only lots with positive stock
  const despatchMap = new Map(despatchByLot.map(d => [d.lotNo, d._sum.than ?? 0]))
  let currentStock = 0
  let totalDespatched = 0
  for (const g of greyByLot) {
    const desp = despatchMap.get(g.lotNo) ?? 0
    totalDespatched += desp
    const balance = (g._sum.than ?? 0) - desp
    if (balance > 0) currentStock += balance
  }

  return NextResponse.json({
    greyEntries: greyCount,
    despatchEntries: despatchCount,
    totalDespatched,
    currentStock,
    parties: partyCount,
  })
}
