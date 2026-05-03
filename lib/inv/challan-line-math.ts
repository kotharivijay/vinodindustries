/**
 * Single source of truth for InvChallanLine money math. Used by:
 *  - line PUT (inline edit)
 *  - challan PATCH (when ratesIncludeGst flips)
 *  - backfill script
 *
 * When ratesIncludeGst = false (default), `rate` is the GST-exclusive
 * unit price. amount = qty*rate - discount, gstAmount = amount * gst%,
 * totalWithGst = amount + gstAmount.
 *
 * When ratesIncludeGst = true, `rate` is GST-inclusive. The taxable
 * amount is gross/(1+gst%), and gstAmount = gross - taxable. totalWithGst
 * equals gross (since GST is already in it).
 */
export interface LineMathInput {
  qty: number
  rate: number | null
  gstRate: number | null
  discountAmount?: number | null
}

export interface LineMathResult {
  grossAmount: number | null
  amount: number | null         // taxable (net of discount, exclusive of GST)
  gstAmount: number | null
  totalWithGst: number | null
}

export function computeLineMath(
  { qty, rate, gstRate, discountAmount }: LineMathInput,
  ratesIncludeGst: boolean,
): LineMathResult {
  if (rate == null || !Number.isFinite(rate)) {
    return { grossAmount: null, amount: null, gstAmount: null, totalWithGst: null }
  }
  const q = Number(qty || 0)
  const r = Number(rate)
  const disc = Number(discountAmount ?? 0)
  const gst = Number(gstRate ?? 0)

  const gross = q * r
  if (ratesIncludeGst && gst > 0) {
    // rate is inclusive — back out the tax from (gross - discount)
    const inclusive = gross - disc
    const taxable = inclusive / (1 + gst / 100)
    const gstAmt = inclusive - taxable
    return {
      grossAmount: round2(gross),
      amount: round2(taxable),
      gstAmount: round2(gstAmt),
      totalWithGst: round2(inclusive),
    }
  }
  const taxable = gross - disc
  const gstAmt = (taxable * gst) / 100
  return {
    grossAmount: round2(gross),
    amount: round2(taxable),
    gstAmount: round2(gstAmt),
    totalWithGst: round2(taxable + gstAmt),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
