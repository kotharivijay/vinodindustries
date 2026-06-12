// Shared invoice math used by both POST /api/inv/invoices (real create)
// and the draft routes (POST /api/inv/invoice-drafts, PATCH the draft,
// POST .../promote). Both paths must produce identical lineRows + totals
// for the same input so the operator's verified preview is exactly what
// gets persisted as the real invoice on promote.
//
// Returns line rows in the shape `invPurchaseInvoiceLine.create` expects,
// plus all the header totals.

import { decideGstTreatment, type GstTreatment } from './gst'
import { computeInvoiceTotals } from './invoice-totals'

const KSI_STATE = process.env.KSI_STATE || 'Rajasthan'

export interface LineInput {
  itemId?: string | number | null
  description?: string | null
  freeTextLabel?: string | null
  qty?: string | number | null
  unit?: string | null
  rate?: string | number | null
  gstRate?: string | number | null
  discountType?: string | null
  discountValue?: string | number | null
  discountAmount?: string | number | null
  challanLineId?: string | number | null
}

export interface BuildInvoiceTotalsInput {
  party: { gstRegistrationType: string; state: string | null }
  lines: LineInput[]
  freightAmount?: string | number | null
  otherCharges?: string | number | null
  discountAmount?: string | number | null
}

export interface BuiltInvoiceLineRow {
  lineNo: number
  itemId: number | null
  challanLineId: number | null
  description: string | null
  freeTextLabel: string | null
  qty: number | null
  unit: string | null
  rate: number | null
  discountType: string | null
  discountValue: number | null
  discountAmount: number | null
  grossAmount: number | null
  amount: number
  gstRate: number | null
  gstAmount: number | null
  total: number
}

export interface BuiltInvoiceTotals {
  gstTreatment: GstTreatment
  isIntra: boolean
  isUnreg: boolean
  lineRows: BuiltInvoiceLineRow[]
  taxableAmount: number
  igstAmount: number
  cgstAmount: number
  sgstAmount: number
  freight: number
  other: number
  totalDiscountAmount: number
  roundOff: number
  totalAmount: number
  hasPendingReviewItems: boolean
}

// Looks up each line's item to (a) auto-fill gstRate when the caller left
// it blank, and (b) flag pending-review items so the invoice / draft can
// be marked and the push-to-Tally pre-validation gates correctly.
type Db = {
  invItem: {
    findUnique: (args: any) => Promise<any>
  }
}

export async function buildInvoiceTotals(
  db: Db,
  { party, lines, freightAmount, otherCharges, discountAmount }: BuildInvoiceTotalsInput,
): Promise<BuiltInvoiceTotals> {
  const gstTreatment = decideGstTreatment(party)
  const isIntra = (party.state || '').toLowerCase() === KSI_STATE.toLowerCase()
  const isUnreg = gstTreatment === 'NONE'

  let lineDiscountTotal = 0
  let hasPendingReviewItems = false
  const lineRows: BuiltInvoiceLineRow[] = []
  const linesForTotals: { amount: number; gstRate: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const qty = Number(l.qty || 0)
    const rate = Number(l.rate || 0)
    const gross = qty * rate
    const discount = Number(l.discountAmount || 0)
    const net = gross - discount

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
  const headerDiscount = Number(discountAmount || 0)
  const totals = computeInvoiceTotals(linesForTotals, freight, headerDiscount, isIntra, isUnreg)
  const totalAmount = totals.total + other
  const totalDiscountAmount = lineDiscountTotal + headerDiscount

  return {
    gstTreatment,
    isIntra,
    isUnreg,
    lineRows,
    taxableAmount: totals.taxable,
    igstAmount: totals.igst,
    cgstAmount: totals.cgst,
    sgstAmount: totals.sgst,
    freight,
    other,
    totalDiscountAmount,
    roundOff: totals.roundOff,
    totalAmount,
    hasPendingReviewItems,
  }
}
