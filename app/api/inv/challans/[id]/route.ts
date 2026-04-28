export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const c = await db.invChallan.findUnique({
    where: { id: Number(params.id) },
    include: {
      party: true,
      po: { select: { id: true, poNo: true } },
      lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } },
      attachments: true,
      invoiceLink: { include: { invoice: { select: { id: true, supplierInvoiceNo: true, status: true } } } },
    },
  })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(c)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const existing = await db.invChallan.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'Invoiced') {
    return NextResponse.json({ error: 'Cannot edit an invoiced challan' }, { status: 409 })
  }

  const body = await req.json()
  const data: any = {}
  for (const k of ['biltyNo', 'vehicleNo', 'transporter', 'notes'] as const) {
    if (body[k] !== undefined) data[k] = body[k] || null
  }
  if (body.defaultDiscountPct !== undefined) {
    data.defaultDiscountPct = body.defaultDiscountPct != null ? Number(body.defaultDiscountPct) : null
  }
  if (body.challanDate) data.challanDate = new Date(body.challanDate)

  // Line edits — body.lines = [{id?,itemId,qty,rate,...}]
  if (Array.isArray(body.lines)) {
    // Strategy: full replace within a transaction. Simple + safe for the
    // small line counts a challan has.
    const lineRows: any[] = []
    let totalQty = 0, totalAmount = 0
    let hasRatelessLines = false
    let hasPendingReviewItems = false
    for (let i = 0; i < body.lines.length; i++) {
      const l = body.lines[i]
      const item = await db.invItem.findUnique({ where: { id: Number(l.itemId) } })
      if (!item) return NextResponse.json({ error: `Item ${l.itemId} not found` }, { status: 404 })
      if (item.reviewStatus === 'pending_review') hasPendingReviewItems = true
      const qty = Number(l.qty || 0)
      const rate = l.rate != null && l.rate !== '' ? Number(l.rate) : null
      if (rate == null) hasRatelessLines = true
      const gross = rate != null ? qty * rate : null
      totalQty += qty
      if (gross != null) totalAmount += gross
      lineRows.push({
        lineNo: i + 1,
        itemId: item.id,
        poLineId: l.poLineId ? Number(l.poLineId) : null,
        qty, unit: l.unit || item.unit, rate, grossAmount: gross, amount: gross,
        discountType: l.discountType || null,
        discountValue: l.discountValue != null ? Number(l.discountValue) : null,
        discountAmount: l.discountAmount != null ? Number(l.discountAmount) : null,
      })
    }
    await db.$transaction([
      db.invChallanLine.deleteMany({ where: { challanId: id } }),
      db.invChallanLine.createMany({ data: lineRows.map(r => ({ ...r, challanId: id })) }),
    ])
    data.totalQty = totalQty
    data.totalAmount = totalAmount
    data.hasRatelessLines = hasRatelessLines
    data.hasPendingReviewItems = hasPendingReviewItems
  }

  const updated = await db.invChallan.update({ where: { id }, data, include: { lines: true } })
  return NextResponse.json(updated)
}
