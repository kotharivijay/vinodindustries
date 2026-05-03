export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeLineMath } from '@/lib/inv/challan-line-math'

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

  // ratesIncludeGst toggle — flip the flag and recompute every line's money
  // columns so the displayed amounts stay consistent with the new mode.
  let ratesIncludeGstChanged = false
  let nextRatesIncludeGst = !!existing.ratesIncludeGst
  if (body.ratesIncludeGst !== undefined && !!body.ratesIncludeGst !== !!existing.ratesIncludeGst) {
    nextRatesIncludeGst = !!body.ratesIncludeGst
    data.ratesIncludeGst = nextRatesIncludeGst
    ratesIncludeGstChanged = true
  }

  // Line edits — body.lines = [{id?,itemId,qty,rate,gstRate,...}]
  if (Array.isArray(body.lines)) {
    const lineRows: any[] = []
    let totalQty = 0, totalAmount = 0, totalGstAmount = 0, totalWithGst = 0
    let hasRatelessLines = false
    let hasPendingReviewItems = false
    for (let i = 0; i < body.lines.length; i++) {
      const l = body.lines[i]
      const item = await db.invItem.findUnique({
        where: { id: Number(l.itemId) },
        include: { alias: { select: { gstRate: true } } },
      })
      if (!item) return NextResponse.json({ error: `Item ${l.itemId} not found` }, { status: 404 })
      if (item.reviewStatus === 'pending_review') hasPendingReviewItems = true
      const qty = Number(l.qty || 0)
      const rate = l.rate != null && l.rate !== '' ? Number(l.rate) : null
      if (rate == null) hasRatelessLines = true
      const gstRate = l.gstRate != null && l.gstRate !== ''
        ? Number(l.gstRate)
        : (item.alias?.gstRate != null ? Number(item.alias.gstRate) : 0)
      const discountAmount = l.discountAmount != null ? Number(l.discountAmount) : null
      const m = computeLineMath({ qty, rate, gstRate, discountAmount }, nextRatesIncludeGst)
      totalQty += qty
      totalAmount += m.amount ?? 0
      totalGstAmount += m.gstAmount ?? 0
      totalWithGst += m.totalWithGst ?? 0
      lineRows.push({
        lineNo: i + 1,
        itemId: item.id,
        poLineId: l.poLineId ? Number(l.poLineId) : null,
        qty,
        unit: l.unit || item.unit,
        rate,
        gstRate,
        grossAmount: m.grossAmount,
        amount: m.amount,
        gstAmount: m.gstAmount,
        totalWithGst: m.totalWithGst,
        discountType: l.discountType || null,
        discountValue: l.discountValue != null ? Number(l.discountValue) : null,
        discountAmount,
      })
    }
    await db.$transaction([
      db.invChallanLine.deleteMany({ where: { challanId: id } }),
      db.invChallanLine.createMany({ data: lineRows.map(r => ({ ...r, challanId: id })) }),
    ])
    data.totalQty = totalQty
    data.totalAmount = totalAmount
    data.totalGstAmount = totalGstAmount
    data.totalWithGst = totalWithGst
    data.hasRatelessLines = hasRatelessLines
    data.hasPendingReviewItems = hasPendingReviewItems
  } else if (ratesIncludeGstChanged) {
    // Toggle flipped without a line replacement — recompute existing lines.
    const lines = await db.invChallanLine.findMany({
      where: { challanId: id },
      include: { item: { include: { alias: { select: { gstRate: true } } } } },
    })
    let totalQty = 0, totalAmount = 0, totalGstAmount = 0, totalWithGst = 0
    const ops: any[] = []
    for (const l of lines) {
      const gstRate = l.gstRate != null
        ? Number(l.gstRate)
        : (l.item?.alias?.gstRate != null ? Number(l.item.alias.gstRate) : 0)
      const m = computeLineMath({
        qty: Number(l.qty),
        rate: l.rate != null ? Number(l.rate) : null,
        gstRate,
        discountAmount: l.discountAmount != null ? Number(l.discountAmount) : null,
      }, nextRatesIncludeGst)
      totalQty += Number(l.qty || 0)
      totalAmount += m.amount ?? 0
      totalGstAmount += m.gstAmount ?? 0
      totalWithGst += m.totalWithGst ?? 0
      ops.push(db.invChallanLine.update({
        where: { id: l.id },
        data: {
          gstRate,
          grossAmount: m.grossAmount,
          amount: m.amount,
          gstAmount: m.gstAmount,
          totalWithGst: m.totalWithGst,
        },
      }))
    }
    if (ops.length) await db.$transaction(ops)
    data.totalQty = totalQty
    data.totalAmount = totalAmount
    data.totalGstAmount = totalGstAmount
    data.totalWithGst = totalWithGst
  }

  const updated = await db.invChallan.update({
    where: { id }, data,
    include: { lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } } },
  })
  return NextResponse.json(updated)
}
