export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch fold programmed than per lot
  const foldBatchLots = await (prisma as any).foldBatchLot.findMany({
    select: { lotNo: true, than: true },
  })
  const foldMap = new Map<string, number>()
  for (const fl of foldBatchLots) {
    const key = fl.lotNo.toLowerCase()
    foldMap.set(key, (foldMap.get(key) ?? 0) + fl.than)
  }

  // Fetch dyeing entry lots WITHOUT fold program (direct dyeing slips)
  const dyeingLots = await (prisma as any).dyeingEntryLot.findMany({
    select: { lotNo: true, than: true, entry: { select: { foldBatchId: true } } },
  })
  const dyeingUsedMap = new Map<string, number>()
  for (const dl of dyeingLots) {
    if (dl.entry?.foldBatchId) continue // already counted via foldMap
    const key = dl.lotNo.toLowerCase()
    dyeingUsedMap.set(key, (dyeingUsedMap.get(key) ?? 0) + dl.than)
  }

  // Fetch manual reservations
  const reservations = await (prisma as any).lotManualReservation.findMany({
    select: { lotNo: true, usedThan: true, note: true },
  })
  const reservationMap = new Map<string, { usedThan: number; note: string | null }>()
  for (const r of reservations) {
    reservationMap.set(r.lotNo.toLowerCase(), { usedThan: r.usedThan, note: r.note })
  }

  // Fetch grey entries grouped by lot
  const greyByLot = await prisma.greyEntry.groupBy({ by: ['lotNo'], _sum: { than: true } })

  // Fetch despatch entries grouped by lot
  const despatchByLot = await prisma.despatchEntry.groupBy({ by: ['lotNo'], _sum: { than: true } })
  const despatchMap = new Map(despatchByLot.map(d => [d.lotNo, d._sum.than ?? 0]))

  // Fetch opening balances
  let obList: any[] = []
  try {
    const db = prisma as any
    obList = await db.lotOpeningBalance.findMany()
  } catch {}
  const obMap = new Map(obList.map((o: any) => [o.lotNo.toLowerCase(), o]))

  // Fetch party + quality per lot from grey entries
  const greyDetails = await prisma.greyEntry.findMany({
    select: { lotNo: true, party: { select: { name: true, tag: true } }, quality: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  const lotDetailMap = new Map(greyDetails.map(g => [g.lotNo.toLowerCase(), { party: g.party.name, quality: g.quality.name, partyTag: g.party.tag }]))

  // Build per-lot stock data
  interface LotStock {
    lotNo: string
    party: string
    partyTag: string | null
    quality: string
    stock: number
    openingBalance: number
    greyThan: number
    despatchThan: number
    foldProgrammed: number
    manuallyUsed: number
    manuallyUsedNote: string | null
    foldAvailable: number
  }

  const lotStocks: LotStock[] = []
  const processedLots = new Set<string>()

  // Lots with current year grey entries
  for (const g of greyByLot) {
    const key = g.lotNo.toLowerCase()
    processedLots.add(key)
    const ob = obMap.get(key)
    const obThan = ob?.openingThan ?? 0
    const greyThan = g._sum.than ?? 0
    const despThan = despatchMap.get(g.lotNo) ?? 0
    const stock = obThan + greyThan - despThan
    if (stock <= 0) continue

    const detail = lotDetailMap.get(key)
    const foldProgrammed = foldMap.get(key) ?? 0
    const dyeingUsed = dyeingUsedMap.get(key) ?? 0
    const reservation = reservationMap.get(key)
    const manuallyUsed = reservation?.usedThan ?? 0
    lotStocks.push({
      lotNo: g.lotNo,
      party: detail?.party ?? ob?.party ?? 'Unknown',
      partyTag: detail?.partyTag ?? null,
      quality: detail?.quality ?? ob?.quality ?? '-',
      stock,
      openingBalance: obThan,
      greyThan,
      despatchThan: despThan,
      foldProgrammed,
      manuallyUsed,
      manuallyUsedNote: reservation?.note ?? null,
      foldAvailable: Math.max(0, stock - foldProgrammed - manuallyUsed - dyeingUsed),
    })
  }

  // Lots with only opening balance
  for (const ob of obList) {
    const key = ob.lotNo.toLowerCase()
    if (processedLots.has(key)) continue
    // Find despatch (case-insensitive)
    let despThan = 0
    for (const [lotNo, than] of despatchMap) {
      if (lotNo.toLowerCase() === key) { despThan = than; break }
    }
    const stock = ob.openingThan - despThan
    if (stock <= 0) continue

    const foldProgrammed = foldMap.get(key) ?? 0
    const dyeingUsed = dyeingUsedMap.get(key) ?? 0
    const reservation = reservationMap.get(key)
    const manuallyUsed = reservation?.usedThan ?? 0
    lotStocks.push({
      lotNo: ob.lotNo,
      party: ob.party || 'Unknown',
      partyTag: null,
      quality: ob.quality || '-',
      stock,
      openingBalance: ob.openingThan,
      greyThan: 0,
      despatchThan: despThan,
      foldProgrammed,
      manuallyUsed,
      manuallyUsedNote: reservation?.note ?? null,
      foldAvailable: Math.max(0, stock - foldProgrammed - manuallyUsed - dyeingUsed),
    })
  }

  // Group by party
  const partyMap = new Map<string, { party: string; partyTag: string | null; totalStock: number; lotCount: number; lots: LotStock[] }>()
  for (const lot of lotStocks) {
    const existing = partyMap.get(lot.party)
    if (existing) {
      existing.totalStock += lot.stock
      existing.lotCount++
      existing.lots.push(lot)
      if (!existing.partyTag && lot.partyTag) existing.partyTag = lot.partyTag
    } else {
      partyMap.set(lot.party, { party: lot.party, partyTag: lot.partyTag, totalStock: lot.stock, lotCount: 1, lots: [lot] })
    }
  }

  // Sort lots within each party by lotNo
  for (const p of partyMap.values()) {
    p.lots.sort((a, b) => a.lotNo.localeCompare(b.lotNo))
  }

  const result = Array.from(partyMap.values())
  const totalStock = result.reduce((s, p) => s + p.totalStock, 0)
  const totalLots = result.reduce((s, p) => s + p.lotCount, 0)

  return NextResponse.json({ parties: result, totalStock, totalLots })
}
