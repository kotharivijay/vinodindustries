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
  // All lotNo maps are keyed lower-case + trimmed: the same logical lot can
  // be stored with different casing across GreyEntry / DespatchEntry /
  // LotOpeningBalance / ReProcessLot, so every cross-table match must be
  // case-insensitive (see the SAM-23-Super stock bug).
  const norm = (s: string) => s.toLowerCase().trim()
  const qualityMap = new Map(qualityEntries.map(e => [norm(e.lotNo), e.quality?.name ?? '']))

  // Despatch totals per lot — combine legacy parents (no children) +
  // multi-lot DespatchEntryLot rows so multi-lot challans don't get
  // attributed entirely to the parent's first lot.
  const despParent = await prisma.despatchEntry.groupBy({
    where: { despatchLots: { none: {} } },
    by: ['lotNo'], _sum: { than: true },
  })
  const despChildren = await prisma.despatchEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } })
  const despatchMap = new Map<string, number>()
  const addDesp = (lotNo: string, than: number) => {
    const k = norm(lotNo)
    despatchMap.set(k, (despatchMap.get(k) || 0) + than)
  }
  for (const d of despParent) addDesp(d.lotNo, d._sum.than ?? 0)
  for (const d of despChildren) addDesp(d.lotNo, d._sum.than ?? 0)

  // Fetch opening balances (carry-forward from last year). Keyed by
  // normalized lotNo, but the original casing is kept for display.
  let obMap = new Map<string, { lotNo: string; ob: number }>()
  try {
    const db = prisma as any
    const obs = await db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } })
    obMap = new Map(obs.map((o: any) => [norm(o.lotNo), { lotNo: o.lotNo, ob: o.openingThan }]))
  } catch {}

  const greyKeys = new Set(greyEntries.map(g => norm(g.lotNo)))

  const lots = greyEntries
    .map(g => {
      const key = norm(g.lotNo)
      const greyThan = g._sum.than ?? 0
      const despatchThan = despatchMap.get(key) ?? 0
      const ob = obMap.get(key)?.ob ?? 0
      const stock = ob + greyThan - despatchThan
      return { lotNo: g.lotNo, greyThan, despatchThan, stock, openingBalance: ob, quality: qualityMap.get(key) ?? '' }
    })
    .filter(l => l.stock > 0) // Only lots with available stock

  // Add lots that ONLY have opening balance (no current year grey entries)
  for (const [key, { lotNo, ob }] of obMap) {
    if (greyKeys.has(key)) continue
    const despThan = despatchMap.get(key) ?? 0
    const stock = ob - despThan
    if (stock > 0) lots.push({ lotNo, greyThan: 0, despatchThan: despThan, stock, openingBalance: ob, quality: qualityMap.get(key) ?? '' })
  }

  // Active RE-PRO lots — surface till they're merged so dyeing/fold pickers
  // can use them as input lots.
  try {
    const db = prisma as any
    const repros = await db.reProcessLot.findMany({
      where: { status: { in: ['pending', 'in-dyeing', 'finished'] } },
    })
    for (const r of repros) {
      const despThan = despatchMap.get(norm(r.reproNo)) ?? 0
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
