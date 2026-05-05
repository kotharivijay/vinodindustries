export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { decideGstTreatment } from '@/lib/inv/gst'
import { computeInvoiceTotals } from '@/lib/inv/invoice-totals'

const KSI_STATE = process.env.KSI_STATE || 'Rajasthan'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const partyId = sp.get('partyId')
  const where: any = {}
  if (status) where.status = status
  if (partyId) where.partyId = Number(partyId)

  const invoices = await db.invPurchaseInvoice.findMany({
    where,
    include: {
      party: { select: { id: true, displayName: true, state: true, gstRegistrationType: true } },
      _count: { select: { lines: true, challans: true } },
    },
    orderBy: { supplierInvoiceDate: 'desc' },
    take: 200,
  })
  return NextResponse.json(invoices)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    partyId, supplierInvoiceNo, supplierInvoiceDate,
    challanIds, lines, freightAmount, otherCharges, defaultDiscountPct, discountAmount, notes,
  } = body
  if (!partyId || !supplierInvoiceNo || !supplierInvoiceDate || !Array.isArray(lines)) {
    return NextResponse.json({ error: 'partyId, supplierInvoiceNo, supplierInvoiceDate, lines required' }, { status: 400 })
  }

  const party = await db.invParty.findUnique({ where: { id: Number(partyId) } })
  if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })

  const gstTreatment = decideGstTreatment(party)
  const isIntra = (party.state || '').toLowerCase() === KSI_STATE.toLowerCase()
  const isUnreg = gstTreatment === 'NONE'

  let lineDiscountTotal = 0
  const lineRows: any[] = []
  let hasPendingReviewItems = false
  const linesForTotals: { amount: number; gstRate: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const qty = Number(l.qty || 0)
    const rate = Number(l.rate || 0)
    const gross = qty * rate
    const discount = Number(l.discountAmount || 0)
    const net = gross - discount

    // gstRate fallback chain: explicit on line → item.alias.gstRate.
    // The challan inline-edit autofills the alias rate visually but only
    // commits on blur; if the operator never touches the field, line.gstRate
    // can arrive null. Falling back at invoice-create time keeps the
    // computed GST honest.
    let item: any = null
    if (l.itemId) {
      item = await db.invItem.findUnique({
        where: { id: Number(l.itemId) },
        include: { alias: { select: { gstRate: true } } },
      })
      if (item?.reviewStatus === 'pending_review') hasPendingReviewItems = true
    }
    const gstRate = l.gstRate != null && l.gstRate !== ''
      ? Number(l.gstRate)
      : (item?.alias?.gstRate != null ? Number(item.alias.gstRate) : 0)
    const lineGstAmt = isUnreg ? 0 : (net * gstRate) / 100
    const lineTotal = net + lineGstAmt

    lineDiscountTotal += discount
    linesForTotals.push({ amount: net, gstRate })

    lineRows.push({
      lineNo: i + 1,
      itemId: l.itemId ? Number(l.itemId) : null,
      challanLineId: l.challanLineId ? Number(l.challanLineId) : null,
      description: l.description || null,
      freeTextLabel: l.freeTextLabel || null,
      qty: l.qty != null ? qty : null,
      unit: l.unit || null,
      rate: l.rate != null ? rate : null,
      discountType: l.discountType || null,
      discountValue: l.discountValue != null ? Number(l.discountValue) : null,
      discountAmount: discount || null,
      grossAmount: gross || null,
      amount: net,
      gstRate: isUnreg ? null : gstRate,
      gstAmount: lineGstAmt || null,
      total: lineTotal,
    })
  }

  const freight = Number(freightAmount || 0)
  const other = Number(otherCharges || 0)
  // Header-level flat discount applies BEFORE GST at the majority rate
  // (computeInvoiceTotals folds freight/discount into the majority bucket).
  const headerDiscount = Number(discountAmount || 0)
  const totals = computeInvoiceTotals(linesForTotals, freight, headerDiscount, isIntra, isUnreg)
  const taxableAmount = totals.taxable
  const igstAmount = totals.igst
  const cgstAmount = totals.cgst
  const sgstAmount = totals.sgst
  // `other` is a residual extra (no GST, no roundoff effect on majority calc);
  // it adds at the end like in the old model.
  const totalAmount = totals.total + other
  const totalDiscountAmount = lineDiscountTotal + headerDiscount

  try {
    const created = await db.$transaction(async (tx: any) => {
      const inv = await tx.invPurchaseInvoice.create({
        data: {
          partyId: Number(partyId),
          supplierInvoiceNo: String(supplierInvoiceNo).trim(),
          supplierInvoiceDate: new Date(supplierInvoiceDate),
          gstTreatment,
          defaultDiscountPct: defaultDiscountPct != null ? Number(defaultDiscountPct) : null,
          taxableAmount,
          igstAmount, cgstAmount, sgstAmount,
          freightAmount: freight,
          totalDiscountAmount,
          otherCharges: other,
          roundOff: totals.roundOff,
          totalAmount,
          hasPendingReviewItems,
          notes: notes || null,
          lines: { create: lineRows },
        },
        include: { lines: true },
      })
      // Link challans + flip their status
      if (Array.isArray(challanIds) && challanIds.length) {
        await tx.invInvoiceChallan.createMany({
          data: challanIds.map((cid: number) => ({ invoiceId: inv.id, challanId: Number(cid) })),
        })
        await tx.invChallan.updateMany({
          where: { id: { in: challanIds.map((c: number) => Number(c)) } },
          data: { status: 'Invoiced' },
        })
      }
      return inv
    })
    return NextResponse.json(created)
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Invoice already exists for this party + supplierInvoiceNo' }, { status: 409 })
    }
    throw e
  }
}
