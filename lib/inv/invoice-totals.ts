/**
 * Single source of truth for purchase-invoice money math.
 *
 * Model (locked 2026-05-04):
 *   - Each line carries its own gstRate; line GST is computed at that rate.
 *   - Freight ADDS to GST base at the majority rate (rate with the highest
 *     line-amount subtotal; ties broken by the higher rate).
 *   - Discount REDUCES the GST base at the majority rate.
 *   - Totals split: state === KSI state → CGST + SGST (each = total/2);
 *     other state → IGST (full amount).
 */

export interface LineForTotals {
  amount: number
  gstRate: number
}

export interface InvoiceTotals {
  linesByRate: Record<string, number>
  majorityRate: number
  gstByRate: Record<string, number>
  totalGst: number
  cgst: number
  sgst: number
  igst: number
  taxable: number
  freight: number
  discount: number
  totalBeforeRound: number
  total: number
  roundOff: number
}

const r2 = (n: number) => +n.toFixed(2)

export function computeInvoiceTotals(
  lines: LineForTotals[],
  freight: number,
  discount: number,
  isIntra: boolean,
  isUnreg: boolean = false,
): InvoiceTotals {
  // Group line amounts by rate
  const linesByRate: Record<string, number> = {}
  for (const l of lines) {
    const r = String(Number(l.gstRate || 0))
    linesByRate[r] = (linesByRate[r] || 0) + Number(l.amount || 0)
  }

  // Majority rate — highest line subtotal; tie-break: higher rate wins
  let majorityRate = 0
  let maxSubtotal = -1
  for (const [r, sub] of Object.entries(linesByRate)) {
    const numR = parseFloat(r)
    if (sub > maxSubtotal || (sub === maxSubtotal && numR > majorityRate)) {
      maxSubtotal = sub
      majorityRate = numR
    }
  }

  // Per-rate GST. Freight adds, discount subtracts — both folded into majority rate.
  const gstByRate: Record<string, number> = {}
  for (const [r, sub] of Object.entries(linesByRate)) {
    const numR = parseFloat(r)
    let base = sub
    if (numR === majorityRate) base += freight - discount
    gstByRate[r] = isUnreg ? 0 : r2(base * (numR / 100))
  }

  const totalGst = r2(Object.values(gstByRate).reduce((s, x) => s + x, 0))
  const taxable = r2(Object.values(linesByRate).reduce((s, x) => s + x, 0))

  let cgst = 0, sgst = 0, igst = 0
  if (!isUnreg) {
    if (isIntra) {
      cgst = r2(totalGst / 2)
      sgst = r2(totalGst - cgst)  // residual to absorb half-paisa rounding
    } else {
      igst = totalGst
    }
  }

  const totalBeforeRound = r2(taxable + freight - discount + totalGst)
  const total = Math.round(totalBeforeRound)
  const roundOff = r2(total - totalBeforeRound)

  return {
    linesByRate, majorityRate, gstByRate, totalGst,
    cgst, sgst, igst,
    taxable, freight, discount,
    totalBeforeRound, total, roundOff,
  }
}
