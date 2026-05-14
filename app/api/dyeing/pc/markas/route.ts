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

  // Get despatch totals per lot. All lot maps are keyed lower-case +
  // trimmed: DespatchEntry / LotManualReservation / LotOpeningBalance can
  // store the same lot with different casing than GreyEntry.
  const norm = (s: string) => s.toLowerCase().trim()
  const lotNoSet = new Set<string>()
  for (const g of greyEntries) lotNoSet.add(g.lotNo as string)
  const lotNos: string[] = Array.from(lotNoSet)
  const lotNoIn = { in: lotNos, mode: 'insensitive' as const }
  const despatchTotals = await prisma.despatchEntry.groupBy({
    by: ['lotNo'],
    where: { lotNo: lotNoIn },
    _sum: { than: true },
  })
  const despatchMap = new Map<string, number>()
  for (const d of despatchTotals) despatchMap.set(norm(d.lotNo), (despatchMap.get(norm(d.lotNo)) || 0) + (d._sum?.than ?? 0))

  // Get manual reservations
  let reserveMap = new Map<string, number>()
  try {
    const reserves = await db.lotManualReservation.findMany({
      where: { lotNo: lotNoIn },
      select: { lotNo: true, usedThan: true },
    })
    reserveMap = new Map(reserves.map((r: any) => [norm(r.lotNo), r.usedThan]))
  } catch {}

  // Get opening balances
  let obMap = new Map<string, number>()
  try {
    const obs = await db.lotOpeningBalance.findMany({
      where: { lotNo: lotNoIn },
      select: { lotNo: true, openingThan: true },
    })
    obMap = new Map(obs.map((o: any) => [norm(o.lotNo), o.openingThan]))
  } catch {}

  // Group grey entries by lot to sum than
  const lotGreyMap = new Map<string, number>()
  for (const g of greyEntries) {
    lotGreyMap.set(norm(g.lotNo), (lotGreyMap.get(norm(g.lotNo)) ?? 0) + g.than)
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
      const key = norm(g.lotNo)
      const greyThan = lotGreyMap.get(key) ?? g.than
      const ob = obMap.get(key) ?? 0
      const desp = despatchMap.get(key) ?? 0
      const reserved = reserveMap.get(key) ?? 0
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
