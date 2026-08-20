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
  // Intra-state only: per-rate CGST(=SGST) head amount. Each head is the sum
  // of per-line round2(amount × rate/200) — Tally Prime's own convention
  // (verified against GSTR-2B recon, Jul 2026), so pushed vouchers match
  // Tally's expected tax and CGST/SGST are always equal.
  gstHalfByRate: Record<string, number>
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

  // Per-rate GST, computed per LINE per duty head with each line rounded to
  // 2dp — exactly how Tally Prime derives its expected tax. Intra: each of
  // CGST/SGST = Σ round2(line × rate/200), so both halves are always equal.
  // Freight adds / discount subtracts as one extra base at the majority rate.
  const rh2 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100
  const gstByRate: Record<string, number> = {}
  const gstHalfByRate: Record<string, number> = {}
  for (const r of Object.keys(linesByRate)) { gstByRate[r] = 0; gstHalfByRate[r] = 0 }
  if (!isUnreg) {
    const addBase = (numR: number, base: number) => {
      const key = String(numR)
      if (isIntra) {
        const half = rh2(base * (numR / 200))
        gstHalfByRate[key] = rh2((gstHalfByRate[key] || 0) + half)
        gstByRate[key] = rh2((gstByRate[key] || 0) + half * 2)
      } else {
        gstByRate[key] = rh2((gstByRate[key] || 0) + rh2(base * (numR / 100)))
      }
    }
    for (const l of lines) addBase(Number(l.gstRate || 0), Number(l.amount || 0))
    const fold = freight - discount
    if (fold !== 0) addBase(majorityRate, fold)
  }

  const totalGst = r2(Object.values(gstByRate).reduce((s, x) => s + x, 0))
  const taxable = r2(Object.values(linesByRate).reduce((s, x) => s + x, 0))

  let cgst = 0, sgst = 0, igst = 0
  if (!isUnreg) {
    if (isIntra) {
      cgst = r2(Object.values(gstHalfByRate).reduce((s, x) => s + x, 0))
      sgst = cgst  // equal by construction — Tally computes each head the same way
    } else {
      igst = totalGst
    }
  }

  const totalBeforeRound = r2(taxable + freight - discount + totalGst)
  const total = Math.round(totalBeforeRound)
  const roundOff = r2(total - totalBeforeRound)

  return {
    linesByRate, majorityRate, gstByRate, gstHalfByRate, totalGst,
    cgst, sgst, igst,
    taxable, freight, discount,
    totalBeforeRound, total, roundOff,
  }
}
