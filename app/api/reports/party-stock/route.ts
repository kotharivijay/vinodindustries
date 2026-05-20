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

  // LotOpeningBalance has no FK to Party — it stores the party as a plain
  // string. Match case-insensitively + whitespace-tolerant so legacy data
  // (multi-space, casing variants) still resolves to this party.
  const partyKey = cleanName.toLowerCase()
  const [grey, dParent, dChildren, allOb] = await Promise.all([
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
    db.lotOpeningBalance.findMany({
      select: {
        id: true, lotNo: true, openingThan: true, greyThan: true, totalDespatched: true,
        party: true, quality: true, financialYear: true, greyDate: true, lrNo: true, marka: true,
      },
    }),
  ])
  const obRows = allOb.filter((o: any) =>
    (o.party || '').replace(/\s+/g, ' ').trim().toLowerCase() === partyKey,
  )

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

  // OB rows arrive as a separate stream so the client can flag them
  // distinctly (variant B shows "OB" badge, variant C shows "Carry forward FY …").
  // Date falls back to FY start when greyDate is null so they still sort
  // before current-year inward.
  const fyStart = (fy: string | null | undefined): Date => {
    const m = (fy || '').match(/(\d{4})/)
    return m ? new Date(`${m[1]}-04-01T00:00:00`) : new Date('2000-04-01')
  }
  const obAsInward = obRows.map((o: any) => ({
    date: o.greyDate || fyStart(o.financialYear),
    challanNo: 0, lotNo: o.lotNo, quality: o.quality || '',
    than: o.openingThan, baleNo: '', bale: null, transportLrNo: o.lrNo || '',
    marka: o.marka || '', openedAt: null,
    isOpeningBalance: true, financialYear: o.financialYear,
  }))
  const currentInward = grey.map((g: any) => ({
    date: g.date, challanNo: g.challanNo, lotNo: g.lotNo, quality: g.quality?.name || '',
    than: g.than, baleNo: g.baleNo || '', bale: g.bale, transportLrNo: g.transportLrNo || '',
    marka: g.marka || '', openedAt: g.openedAt,
    isOpeningBalance: false, financialYear: null,
  }))
  const inwardRows = [...obAsInward, ...currentInward]
    .sort((a: any, b: any) => a.date.getTime() - b.date.getTime())

  const obThan = obAsInward.reduce((s: number, r: any) => s + r.than, 0)
  const currentInwardThan = currentInward.reduce((s: number, r: any) => s + r.than, 0)
  const inwardThan = obThan + currentInwardThan
  const outwardThan = outwardRows.reduce((s: number, r: any) => s + r.than, 0)
  const balance = inwardThan - outwardThan

  // Per-lot rollup. obThan is tracked separately so the UI can show it as
  // a sub-figure without losing it in the combined inward total.
  const lotMap = new Map<string, any>()
  const ensure = (key: string) => {
    if (!lotMap.has(key)) lotMap.set(key, {
      lotNo: key, quality: '', inward: 0, obThan: 0, currentInward: 0, outward: 0,
      firstInward: null, lastOutward: null,
      inwardRows: [] as any[], outwardRows: [] as any[],
    })
    return lotMap.get(key)
  }
  for (const r of inwardRows) {
    const e = ensure(r.lotNo.toUpperCase())
    e.quality = e.quality || r.quality
    e.inward += r.than
    if (r.isOpeningBalance) e.obThan += r.than
    else e.currentInward += r.than
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
    summary: {
      inwardThan, outwardThan, balance,
      obThan, currentInwardThan,
      lotCount: perLot.length,
      openLotCount: perLot.filter(l => l.balance > 0).length,
      obLotCount: obRows.length,
    },
    perLot,
    inwardRows,
    outwardRows,
  })
}
