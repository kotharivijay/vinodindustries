export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Party stock report — inward (GreyEntry) vs outward (DespatchEntry +
 * DespatchEntryLot) for a single party. Used by the Party Stock Report
 * page to render Summary / Ledger / Lot-wise PDFs and the Excel exports.
 *
 *   GET /api/reports/party-stock?action=parties     → list parties (for the dropdown)
 *   GET /api/reports/party-stock?partyId=N          → full report payload
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const action = sp.get('action')

  if (action === 'parties') {
    // Only parties that actually have inward or outward movement, so the
    // dropdown doesn't drown in inactive masters.
    const parties = await db.party.findMany({
      where: {
        OR: [
          { greyEntries: { some: {} } },
          { despatchEntries: { some: {} } },
        ],
      },
      select: { id: true, name: true, tag: true },
      orderBy: { name: 'asc' },
    })
    // Cleaned names — collapse stray whitespace so legacy multi-space rows
    // ("Shri Shantinath Textile      Pali Marwar") display nicely.
    const cleaned = parties.map((p: any) => ({
      id: p.id, name: p.name.replace(/\s+/g, ' ').trim(), tag: p.tag,
    }))
    return NextResponse.json({ parties: cleaned })
  }

  const partyId = Number(sp.get('partyId'))
  if (!Number.isFinite(partyId)) {
    return NextResponse.json({ error: 'partyId required' }, { status: 400 })
  }
  const party = await db.party.findUnique({
    where: { id: partyId },
    select: { id: true, name: true, tag: true, lotPrefixes: true },
  })
  if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })
  const cleanName = party.name.replace(/\s+/g, ' ').trim()

  const [grey, dParent, dChildren] = await Promise.all([
    db.greyEntry.findMany({
      where: { partyId },
      select: {
        id: true, date: true, challanNo: true, lotNo: true, than: true,
        baleNo: true, bale: true, transportLrNo: true, marka: true, openedAt: true,
        quality: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    }),
    db.despatchEntry.findMany({
      where: { partyId, despatchLots: { none: {} } },
      select: { id: true, date: true, challanNo: true, lotNo: true, than: true, billNo: true,
        quality: { select: { name: true } }, narration: true },
      orderBy: { date: 'asc' },
    }),
    db.despatchEntryLot.findMany({
      where: { entry: { partyId } },
      select: {
        id: true, lotNo: true, than: true,
        entry: { select: { date: true, challanNo: true, billNo: true } },
        quality: { select: { name: true } },
      },
    }),
  ])

  // Flatten outward into one list (parent and lot-child rows have the same shape).
  const outwardRows = [
    ...dParent.map((d: any) => ({
      date: d.date, challanNo: d.challanNo, lotNo: d.lotNo, quality: d.quality?.name || '',
      than: d.than, billNo: d.billNo, narration: d.narration || '',
    })),
    ...dChildren.map((d: any) => ({
      date: d.entry.date, challanNo: d.entry.challanNo, lotNo: d.lotNo, quality: d.quality?.name || '',
      than: d.than, billNo: d.entry.billNo, narration: '',
    })),
  ].sort((a: any, b: any) => a.date.getTime() - b.date.getTime())

  const inwardRows = grey.map((g: any) => ({
    date: g.date, challanNo: g.challanNo, lotNo: g.lotNo, quality: g.quality?.name || '',
    than: g.than, baleNo: g.baleNo || '', bale: g.bale, transportLrNo: g.transportLrNo || '',
    marka: g.marka || '', openedAt: g.openedAt,
  }))

  const inwardThan = inwardRows.reduce((s: number, r: any) => s + r.than, 0)
  const outwardThan = outwardRows.reduce((s: number, r: any) => s + r.than, 0)
  const balance = inwardThan - outwardThan

  // Per-lot rollup
  const lotMap = new Map<string, any>()
  const ensure = (key: string) => {
    if (!lotMap.has(key)) lotMap.set(key, {
      lotNo: key, quality: '', inward: 0, outward: 0,
      firstInward: null, lastOutward: null,
      inwardRows: [] as any[], outwardRows: [] as any[],
    })
    return lotMap.get(key)
  }
  for (const r of inwardRows) {
    const e = ensure(r.lotNo.toUpperCase())
    e.quality = e.quality || r.quality
    e.inward += r.than
    e.inwardRows.push(r)
    if (!e.firstInward || r.date < e.firstInward) e.firstInward = r.date
  }
  for (const r of outwardRows) {
    const e = ensure(r.lotNo.toUpperCase())
    e.quality = e.quality || r.quality
    e.outward += r.than
    e.outwardRows.push(r)
    if (!e.lastOutward || r.date > e.lastOutward) e.lastOutward = r.date
  }
  const perLot = Array.from(lotMap.values())
    .map(e => ({ ...e, balance: e.inward - e.outward }))
    .sort((a, b) => (a.firstInward?.getTime?.() || 0) - (b.firstInward?.getTime?.() || 0))

  return NextResponse.json({
    party: { id: party.id, name: cleanName, tag: party.tag, lotPrefixes: party.lotPrefixes },
    summary: { inwardThan, outwardThan, balance, lotCount: perLot.length, openLotCount: perLot.filter(l => l.balance > 0).length },
    perLot,
    inwardRows,
    outwardRows,
  })
}
