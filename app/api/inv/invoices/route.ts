export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { decideGstTreatment } from '@/lib/inv/gst'

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

  let taxableAmount = 0, igstAmount = 0, cgstAmount = 0, sgstAmount = 0
  let lineDiscountTotal = 0
  const lineRows: any[] = []
  let hasPendingReviewItems = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const qty = Number(l.qty || 0)
    const rate = Number(l.rate || 0)
    const gross = qty * rate
    const discount = Number(l.discountAmount || 0)
    const net = gross - discount
    const gstRate = Number(l.gstRate || 0)
    const gstAmt = gstTreatment === 'NONE' ? 0 : (net * gstRate) / 100
    const total = net + gstAmt

    if (l.itemId) {
      const item = await db.invItem.findUnique({ where: { id: Number(l.itemId) } })
      if (item?.reviewStatus === 'pending_review') hasPendingReviewItems = true
    }

    taxableAmount += net
    lineDiscountTotal += discount
    if (gstTreatment === 'IGST') igstAmount += gstAmt
    else if (gstTreatment === 'CGST_SGST') {
      cgstAmount += gstAmt / 2
      sgstAmount += gstAmt / 2
    }

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
      gstRate: gstTreatment === 'NONE' ? null : gstRate,
      gstAmount: gstAmt || null,
      total,
    })
  }

  const freight = Number(freightAmount || 0)
  const other = Number(otherCharges || 0)
  // Header-level flat discount (separate from per-line). Subtracted once
  // at the bottom — does NOT reduce taxableAmount or GST.
  const headerDiscount = Number(discountAmount || 0)
  // Per-line discount is already baked into taxableAmount via `net`, so the
  // grand total only subtracts the header discount. (Was previously double-
  // subtracting per-line discounts; the totalDiscountAmount field is now
  // purely informational — sum of per-line + header.)
  const totalAmount = taxableAmount + igstAmount + cgstAmount + sgstAmount + freight + other - headerDiscount
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
