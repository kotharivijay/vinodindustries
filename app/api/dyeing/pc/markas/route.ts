export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyId = req.nextUrl.searchParams.get('partyId')
  if (!partyId) return NextResponse.json({ error: 'partyId required' }, { status: 400 })

  const db = prisma as any

  // Get all grey entries for this party that have a marka (from marka field OR viverNameBill)
  const greyEntries = await db.greyEntry.findMany({
    where: {
      partyId: parseInt(partyId),
      OR: [
        { marka: { not: '' } },
        { viverNameBill: { not: '' } },
      ],
      NOT: [
        { marka: null, viverNameBill: null },
      ],
    },
    select: {
      id: true,
      lotNo: true,
      than: true,
      marka: true,
      viverNameBill: true,
      date: true,
    },
    orderBy: { date: 'desc' },
  })
  // Use marka field first, fallback to viverNameBill
  for (const g of greyEntries) {
    if (!g.marka && g.viverNameBill) g.marka = g.viverNameBill
  }

  // Get despatch totals per lot
  const lotNoSet = new Set<string>()
  for (const g of greyEntries) lotNoSet.add(g.lotNo as string)
  const lotNos: string[] = Array.from(lotNoSet)
  const despatchTotals = await prisma.despatchEntry.groupBy({
    by: ['lotNo'],
    where: { lotNo: { in: lotNos } },
    _sum: { than: true },
  })
  const despatchMap = new Map(despatchTotals.map(d => [d.lotNo, d._sum?.than ?? 0]))

  // Get manual reservations
  let reserveMap = new Map<string, number>()
  try {
    const reserves = await db.lotManualReservation.findMany({
      where: { lotNo: { in: lotNos } },
      select: { lotNo: true, usedThan: true },
    })
    reserveMap = new Map(reserves.map((r: any) => [r.lotNo, r.usedThan]))
  } catch {}

  // Get opening balances
  let obMap = new Map<string, number>()
  try {
    const obs = await db.lotOpeningBalance.findMany({
      where: { lotNo: { in: lotNos } },
      select: { lotNo: true, openingThan: true },
    })
    obMap = new Map(obs.map((o: any) => [o.lotNo, o.openingThan]))
  } catch {}

  // Group grey entries by lot to sum than
  const lotGreyMap = new Map<string, number>()
  for (const g of greyEntries) {
    lotGreyMap.set(g.lotNo, (lotGreyMap.get(g.lotNo) ?? 0) + g.than)
  }

  // Group by marka
  const markaMap = new Map<string, { marka: string; lots: { lotNo: string; greyThan: number; availableThan: number }[] }>()

  // Track lots we've already added per marka
  const addedLots = new Map<string, Set<string>>()

  for (const g of greyEntries) {
    const m = g.marka as string
    if (!markaMap.has(m)) {
      markaMap.set(m, { marka: m, lots: [] })
      addedLots.set(m, new Set())
    }
    const group = markaMap.get(m)!
    const lotSet = addedLots.get(m)!

    if (!lotSet.has(g.lotNo)) {
      lotSet.add(g.lotNo)
      const greyThan = lotGreyMap.get(g.lotNo) ?? g.than
      const ob = obMap.get(g.lotNo) ?? 0
      const desp = despatchMap.get(g.lotNo) ?? 0
      const reserved = reserveMap.get(g.lotNo) ?? 0
      const available = ob + greyThan - desp - reserved
      group.lots.push({
        lotNo: g.lotNo,
        greyThan,
        availableThan: Math.max(0, available),
      })
    }
  }

  // Filter out lots with 0 available, then filter out markas with no lots
  const result = Array.from(markaMap.values())
    .map(mg => ({ ...mg, lots: mg.lots.filter(l => l.availableThan > 0) }))
    .filter(mg => mg.lots.length > 0)
  return NextResponse.json(result)
}
