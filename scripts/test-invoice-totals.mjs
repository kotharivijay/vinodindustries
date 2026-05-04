// Quick smoke test — port of computeInvoiceTotals
const r2 = n => +n.toFixed(2)
function computeInvoiceTotals(lines, freight, discount, isIntra, isUnreg = false) {
  const linesByRate = {}
  for (const l of lines) {
    const r = String(Number(l.gstRate || 0))
    linesByRate[r] = (linesByRate[r] || 0) + Number(l.amount || 0)
  }
  let majorityRate = 0, maxSubtotal = -1
  for (const [r, sub] of Object.entries(linesByRate)) {
    const numR = parseFloat(r)
    if (sub > maxSubtotal || (sub === maxSubtotal && numR > majorityRate)) {
      maxSubtotal = sub; majorityRate = numR
    }
  }
  const gstByRate = {}
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
    if (isIntra) { cgst = r2(totalGst / 2); sgst = r2(totalGst - cgst) }
    else { igst = totalGst }
  }
  const totalBeforeRound = r2(taxable + freight - discount + totalGst)
  const total = Math.round(totalBeforeRound)
  const roundOff = r2(total - totalBeforeRound)
  return { linesByRate, majorityRate, gstByRate, totalGst, cgst, sgst, igst, taxable, freight, discount, totalBeforeRound, total, roundOff }
}

// Test 1: invoice 1 (single line @ 18%, freight 125, no discount, intra)
console.log('TEST 1: single line + freight, Rajasthan')
console.log(computeInvoiceTotals(
  [{ amount: 16250, gstRate: 18 }], 125, 0, true,
))
console.log('Expected: GST = 16375 × 18% = 2947.50; total ≈ round(19322.50) = 19323; cgst+sgst should match\n')

// Test 2: multi-rate, freight + discount
console.log('TEST 2: 2 rates (70% at 18%, 30% at 12%), freight 200, discount 100, intra')
console.log(computeInvoiceTotals(
  [{ amount: 14000, gstRate: 18 }, { amount: 6000, gstRate: 12 }], 200, 100, true,
))
console.log('Expected: majority=18; 18% on (14000+200-100)=14100 → 2538; 12% on 6000 → 720; totalGst=3258\n')

// Test 3: inter-state (IGST)
console.log('TEST 3: inter-state, single line 18%, freight 50')
console.log(computeInvoiceTotals(
  [{ amount: 10000, gstRate: 18 }], 50, 0, false,
))
console.log('Expected: igst = (10000+50) × 18% = 1809; total ≈ round(11859) = 11859\n')

// Test 4: unregistered party (no GST)
console.log('TEST 4: unregistered party, freight 100, discount 50')
console.log(computeInvoiceTotals(
  [{ amount: 5000, gstRate: 0 }], 100, 50, true, true,
))
console.log('Expected: no GST; total = 5000 + 100 - 50 = 5050\n')

// Test 5: tie-break (50/50 split, higher rate wins)
console.log('TEST 5: tie-break (5000@18% + 5000@12%), freight 100')
console.log(computeInvoiceTotals(
  [{ amount: 5000, gstRate: 18 }, { amount: 5000, gstRate: 12 }], 100, 0, true,
))
console.log('Expected: majority=18 (tie-break to higher); 18% on (5000+100)=5100 → 918; 12% on 5000 → 600; totalGst=1518')
