export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get all grey entries grouped by lotNo
  const greyEntries = await prisma.greyEntry.groupBy({
    by: ['lotNo'],
    _sum: { than: true },
  })

  // Fetch quality name per lot (first grey entry per lot)
  const qualityEntries = await prisma.greyEntry.findMany({
    distinct: ['lotNo'],
    select: { lotNo: true, quality: { select: { name: true } } },
    orderBy: { id: 'asc' },
  })
  const qualityMap = new Map(qualityEntries.map(e => [e.lotNo, e.quality?.name ?? '']))

  // Despatch totals per lot — combine legacy parents (no children) +
  // multi-lot DespatchEntryLot rows so multi-lot challans don't get
  // attributed entirely to the parent's first lot.
  const despParent = await prisma.despatchEntry.groupBy({
    where: { despatchLots: { none: {} } },
    by: ['lotNo'], _sum: { than: true },
  })
  const despChildren = await prisma.despatchEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } })
  const despatchMap = new Map<string, number>()
  for (const d of despParent) despatchMap.set(d.lotNo, (despatchMap.get(d.lotNo) || 0) + (d._sum.than ?? 0))
  for (const d of despChildren) despatchMap.set(d.lotNo, (despatchMap.get(d.lotNo) || 0) + (d._sum.than ?? 0))

  // Fetch opening balances (carry-forward from last year)
  let obMap = new Map<string, number>()
  try {
    const db = prisma as any
    const obs = await db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } })
    obMap = new Map(obs.map((o: any) => [o.lotNo, o.openingThan]))
  } catch {}

  const lots = greyEntries
    .map(g => {
      const greyThan = g._sum.than ?? 0
      const despatchThan = despatchMap.get(g.lotNo) ?? 0
      const ob = obMap.get(g.lotNo) ?? 0
      const stock = ob + greyThan - despatchThan
      return { lotNo: g.lotNo, greyThan, despatchThan, stock, openingBalance: ob, quality: qualityMap.get(g.lotNo) ?? '' }
    })
    .filter(l => l.stock > 0) // Only lots with available stock

  // Add lots that ONLY have opening balance (no current year grey entries)
  for (const [lotNo, ob] of obMap) {
    if (!lots.some(l => l.lotNo === lotNo)) {
      const despThan = despatchMap.get(lotNo) ?? 0
      const stock = ob - despThan
      if (stock > 0) lots.push({ lotNo, greyThan: 0, despatchThan: despThan, stock, openingBalance: ob, quality: qualityMap.get(lotNo) ?? '' })
    }
  }

  // Active RE-PRO lots — surface till they're merged so dyeing/fold pickers
  // can use them as input lots.
  try {
    const db = prisma as any
    const repros = await db.reProcessLot.findMany({
      where: { status: { in: ['pending', 'in-dyeing', 'finished'] } },
    })
    for (const r of repros) {
      const despThan = despatchMap.get(r.reproNo) ?? 0
      const stock = r.totalThan - despThan
      if (stock <= 0) continue
      lots.push({
        lotNo: r.reproNo,
        greyThan: r.totalThan,
        despatchThan: despThan,
        stock,
        openingBalance: 0,
        quality: r.quality || '',
      })
    }
  } catch {}

  lots.sort((a, b) => a.lotNo.localeCompare(b.lotNo))

  return NextResponse.json(lots)
}
