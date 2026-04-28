export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { allocateSeries } from '@/lib/inv/series'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const partyId = sp.get('partyId')
  const from = sp.get('from')
  const to = sp.get('to')
  const q = (sp.get('q') || '').trim().toLowerCase()

  const where: any = {}
  if (status) where.status = status
  if (partyId) where.partyId = Number(partyId)
  if (from || to) {
    where.challanDate = {}
    if (from) where.challanDate.gte = new Date(from)
    if (to) where.challanDate.lte = new Date(to)
  }
  if (q) where.OR = [
    { challanNo: { contains: q, mode: 'insensitive' } },
    { biltyNo: { contains: q, mode: 'insensitive' } },
    { vehicleNo: { contains: q, mode: 'insensitive' } },
  ]

  const challans = await db.invChallan.findMany({
    where,
    include: {
      party: { select: { id: true, displayName: true } },
      lines: { select: { id: true, qty: true, rate: true } },
    },
    orderBy: { challanDate: 'desc' },
    take: 200,
  })
  return NextResponse.json(challans)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    partyId, poId, challanNo, challanDate, biltyNo, vehicleNo, transporter,
    defaultDiscountPct, lines, notes,
  } = body

  if (!partyId || !challanNo || !challanDate || !Array.isArray(lines)) {
    return NextResponse.json({ error: 'partyId, challanNo, challanDate, lines required' }, { status: 400 })
  }

  // Duplicate guard: same (partyId, challanNo) within ±3 days
  const date = new Date(challanDate)
  const lo = new Date(date); lo.setDate(lo.getDate() - 3)
  const hi = new Date(date); hi.setDate(hi.getDate() + 3)
  const dup = await db.invChallan.findFirst({
    where: { partyId, challanNo: String(challanNo).trim(), challanDate: { gte: lo, lte: hi } },
    select: { id: true, internalSeriesNo: true, seriesFy: true },
  })
  if (dup) return NextResponse.json({ error: 'Duplicate challan within ±3 days', dup }, { status: 409 })

  // Allocate gap-free series number
  const { no, fy } = await allocateSeries('inward')

  // Compute totals; flag rateless lines
  let totalQty = 0, totalAmount = 0
  let hasRatelessLines = false
  let hasPendingReviewItems = false
  const lineRows: any[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const qty = Number(l.qty || 0)
    const rate = l.rate != null && l.rate !== '' ? Number(l.rate) : null
    const item = await db.invItem.findUnique({ where: { id: Number(l.itemId) } })
    if (!item) return NextResponse.json({ error: `Item ${l.itemId} not found` }, { status: 404 })
    if (item.reviewStatus === 'pending_review') hasPendingReviewItems = true
    if (rate == null) hasRatelessLines = true
    const gross = rate != null ? qty * rate : null
    totalQty += qty
    if (gross != null) totalAmount += gross
    lineRows.push({
      lineNo: i + 1,
      itemId: item.id,
      poLineId: l.poLineId ? Number(l.poLineId) : null,
      qty, unit: l.unit || item.unit,
      rate,
      grossAmount: gross,
      amount: gross,
      discountType: l.discountType || null,
      discountValue: l.discountValue != null ? Number(l.discountValue) : null,
      discountAmount: l.discountAmount != null ? Number(l.discountAmount) : null,
    })
  }

  const created = await db.invChallan.create({
    data: {
      partyId: Number(partyId),
      poId: poId ? Number(poId) : null,
      internalSeriesNo: no,
      seriesFy: fy,
      challanNo: String(challanNo).trim(),
      challanDate: date,
      biltyNo: biltyNo || null,
      vehicleNo: vehicleNo || null,
      transporter: transporter || null,
      defaultDiscountPct: defaultDiscountPct != null ? Number(defaultDiscountPct) : null,
      totalQty,
      totalAmount,
      hasRatelessLines,
      hasPendingReviewItems,
      notes: notes || null,
      lines: { create: lineRows },
    },
    include: { lines: true, party: true },
  })
  return NextResponse.json(created)
}
