export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { appendRowToSheet, greyEntryToSheetRow } from '@/lib/sheets'
import { normalizeLotNo } from '@/lib/lot-no'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `?includeZero=1` keeps fully-consumed carry-forward (OB) and RE-PRO lots
  // in the response so the Grey Inward stock list can show 0-stock OB lots
  // for audit. Current-year grey rows always show regardless.
  const includeZero = req.nextUrl.searchParams.get('includeZero') === '1'

  // Despatched per lot — combine legacy single-lot DespatchEntry rows
  // (no children) with multi-lot DespatchEntryLot rows. Reading parent
  // alone caused multi-lot challans to attribute the WHOLE challan total
  // to the parent's first lot (e.g. SAM-20 showed 310 desp instead of 50).
  const [entries, despParentTotals, despLotTotals] = await Promise.all([
    prisma.greyEntry.findMany({
      include: { party: true, quality: true, transport: true, weaver: true },
      orderBy: { date: 'desc' },
    }),
    prisma.despatchEntry.groupBy({
      where: { despatchLots: { none: {} } },
      by: ['lotNo'],
      _sum: { than: true },
    }),
    prisma.despatchEntryLot.groupBy({
      by: ['lotNo'],
      _sum: { than: true },
    }),
  ])

  // despatchMap is keyed lower-case — DespatchEntry / DespatchEntryLot lotNo
  // casing can differ from GreyEntry / OB / ReProcessLot.
  const despatchMap = new Map<string, number>()
  const bumpDesp = (lot: string, n: number) => {
    const k = lot.toLowerCase()
    despatchMap.set(k, (despatchMap.get(k) || 0) + n)
  }
  for (const d of despParentTotals) bumpDesp(d.lotNo, d._sum.than ?? 0)
  for (const d of despLotTotals) bumpDesp(d.lotNo, d._sum.than ?? 0)

  // Fetch opening balances (carry-forward from last year)
  let obMap = new Map<string, number>()
  try {
    const db = prisma as any
    const obs = await db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } })
    obMap = new Map(obs.map((o: any) => [o.lotNo.toLowerCase(), o.openingThan]))
  } catch {}

  // Track which lots already have grey entries
  const lotsWithGrey = new Set(entries.map(e => e.lotNo.toLowerCase()))

  const enriched = entries.map((e) => {
    const key = e.lotNo.toLowerCase()
    const ob = obMap.get(key) ?? 0
    const desp = despatchMap.get(key) ?? 0
    return {
      ...e,
      tDesp: desp,
      stock: ob + e.than - desp,
      openingBalance: ob,
    }
  })

  // Add carry-forward-only lots (no current year grey entries)
  let obOnlyLots: any[] = []
  try {
    const db = prisma as any
    const allObs = await db.lotOpeningBalance.findMany()
    for (const ob of allObs) {
      if (lotsWithGrey.has(ob.lotNo.toLowerCase())) continue
      const despThan = despatchMap.get(ob.lotNo.toLowerCase()) ?? 0
      const stock = ob.openingThan - despThan
      if (!includeZero && stock <= 0) continue
      obOnlyLots.push({
        id: -ob.id, // negative id to distinguish from real entries
        sn: null,
        date: ob.createdAt,
        challanNo: 0,
        party: { id: 0, name: ob.party || 'Carry Forward' },
        quality: { id: 0, name: ob.quality || '-' },
        transport: { id: 0, name: '-' },
        weaver: { id: 0, name: '-' },
        weight: null,
        than: ob.openingThan,
        grayMtr: null,
        transportLrNo: null,
        bale: null,
        baleNo: null,
        echBaleThan: null,
        viverNameBill: null,
        lrNo: null,
        lotNo: ob.lotNo,
        tDesp: despThan,
        stock,
        openingBalance: ob.openingThan,
        isCarryForward: true,
      })
    }
  } catch {}

  // Add active RE-PRO lots (status not yet merged) as synthetic entries
  let reproLots: any[] = []
  try {
    const db = prisma as any
    const repros = await db.reProcessLot.findMany({
      where: { status: { in: ['pending', 'in-dyeing', 'finished'] } },
    })
    for (const r of repros) {
      const despThan = despatchMap.get(r.reproNo.toLowerCase()) ?? 0
      const stock = r.totalThan - despThan
      if (!includeZero && stock <= 0) continue
      reproLots.push({
        id: -10000 - r.id,
        sn: null,
        date: r.createdAt,
        challanNo: 0,
        party: { id: 0, name: 'Re-Process' },
        quality: { id: 0, name: r.quality || '-' },
        transport: { id: 0, name: '-' },
        weaver: { id: 0, name: '-' },
        weight: r.weight,
        than: r.totalThan,
        grayMtr: r.grayMtr,
        transportLrNo: null,
        bale: null,
        baleNo: null,
        echBaleThan: null,
        viverNameBill: null,
        lrNo: null,
        lotNo: r.reproNo,
        tDesp: despThan,
        stock,
        openingBalance: 0,
        isReProcess: true,
        reproStatus: r.status,
      })
    }
  } catch {}

  return NextResponse.json([...enriched, ...obOnlyLots, ...reproLots])
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  // SN: if the operator left it blank, allocate max(sn)+1 instead of leaving
  // the column null (otherwise downstream displays fall back to the row id,
  // which is in the thousands and looks like a runaway counter).
  let resolvedSn: number | undefined
  if (data.sn != null && data.sn !== '') {
    resolvedSn = parseInt(data.sn)
  } else {
    const top = await prisma.greyEntry.aggregate({ where: { sn: { gt: 0 } }, _max: { sn: true } })
    resolvedSn = (top._max.sn ?? 0) + 1
  }

  const entry = await prisma.greyEntry.create({
    data: {
      sn: resolvedSn,
      date: new Date(data.date),
      challanNo: parseInt(data.challanNo),
      partyId: parseInt(data.partyId),
      qualityId: parseInt(data.qualityId),
      weight: data.weight ? data.weight.toString() : undefined,
      than: parseInt(data.than),
      grayMtr: data.grayMtr ? parseFloat(data.grayMtr) : undefined,
      transportId: parseInt(data.transportId),
      transportLrNo: data.transportLrNo || undefined,
      bale: data.bale ? parseInt(data.bale) : undefined,
      baleNo: data.baleNo || undefined,
      echBaleThan: data.echBaleThan ? parseFloat(data.echBaleThan) : undefined,
      weaverId: data.weaverId != null && data.weaverId !== '' ? parseInt(data.weaverId) : undefined,
      viverNameBill: data.viverNameBill || undefined,
      lrNo: data.lrNo || undefined,
      lotNo: normalizeLotNo(data.lotNo) ?? '',
      marka: data.marka?.trim() || undefined,
    },
    include: { party: true, quality: true, transport: true, weaver: true },
  })

  // Auto-append to Google Sheet (non-blocking — silent if service account not configured)
  appendRowToSheet(greyEntryToSheetRow(entry)).catch(() => {})

  return NextResponse.json(entry, { status: 201 })
}

// DELETE all — reset entire grey table
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { confirm } = await req.json().catch(() => ({}))
  if (confirm !== 'RESET_GREY') {
    return NextResponse.json({ error: 'Confirmation required: send { confirm: "RESET_GREY" }' }, { status: 400 })
  }

  await prisma.greyEntry.deleteMany({})
  await (prisma as any).lotOpeningBalance.deleteMany({})
  return NextResponse.json({ ok: true, message: 'All grey entries deleted' })
}
