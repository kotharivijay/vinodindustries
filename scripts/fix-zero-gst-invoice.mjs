// Find Draft invoices with any line at gstRate=null and fix by pulling
// the rate from item.alias.gstRate. Recompute totals via the same helper
// the server uses so it matches the new model exactly.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

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
  return { totalGst, cgst, sgst, igst, taxable, total, roundOff }
}

const KSI_STATE = (process.env.KSI_STATE || 'Rajasthan').toLowerCase()

const APPLY = process.argv.includes('--apply')

const drafts = await prisma.invPurchaseInvoice.findMany({
  where: { status: 'Draft' },
  include: {
    party: { select: { state: true, gstRegistrationType: true } },
    lines: { include: { item: { include: { alias: { select: { gstRate: true } } } } } },
  },
})
console.log(`Drafts: ${drafts.length}`)

for (const inv of drafts) {
  // Catch both null and explicit 0 when the alias has a non-zero rate.
  const offending = inv.lines.filter(l =>
    (l.gstRate == null || Number(l.gstRate) === 0) &&
    l.item?.alias?.gstRate != null && Number(l.item.alias.gstRate) > 0,
  )
  if (offending.length === 0) continue
  console.log(`\nInvoice id=${inv.id} ${inv.supplierInvoiceNo} — ${offending.length} line(s) need fix`)
  for (const l of offending) {
    console.log(`  line ${l.lineNo}: ${l.item.displayName} → set gstRate=${l.item.alias.gstRate}`)
  }

  if (!APPLY) continue

  const isIntra = (inv.party.state || '').toLowerCase() === KSI_STATE
  const isUnreg = ['Unregistered', 'Composition'].includes(inv.party.gstRegistrationType)

  // Patch each line: set gstRate from alias, recompute gstAmount + total
  await prisma.$transaction(async tx => {
    const refreshed = []
    for (const l of inv.lines) {
      const aliasR = l.item?.alias?.gstRate != null ? Number(l.item.alias.gstRate) : 0
      const lineR = l.gstRate != null ? Number(l.gstRate) : 0
      // When stored rate is 0 but alias has a real rate, prefer alias.
      const newGstRate = (lineR === 0 && aliasR > 0) ? aliasR : lineR
      const lineGstAmt = isUnreg ? 0 : r2(Number(l.amount) * newGstRate / 100)
      await tx.invPurchaseInvoiceLine.update({
        where: { id: l.id },
        data: {
          gstRate: isUnreg ? null : newGstRate,
          gstAmount: lineGstAmt || null,
          total: Number(l.amount) + lineGstAmt,
        },
      })
      refreshed.push({ amount: Number(l.amount), gstRate: newGstRate })
    }

    const t = computeInvoiceTotals(
      refreshed,
      Number(inv.freightAmount),
      Number(inv.totalDiscountAmount),
      isIntra, isUnreg,
    )
    const totalAmount = t.total + Number(inv.otherCharges || 0)

    await tx.invPurchaseInvoice.update({
      where: { id: inv.id },
      data: {
        taxableAmount: t.taxable,
        igstAmount: t.igst,
        cgstAmount: t.cgst,
        sgstAmount: t.sgst,
        roundOff: t.roundOff,
        totalAmount,
      },
    })
    console.log(`  → updated. taxable=${t.taxable} cgst=${t.cgst} sgst=${t.sgst} igst=${t.igst} total=${totalAmount}`)
  })
}
if (!APPLY) console.log('\n[dry-run only — pass --apply]')
await prisma.$disconnect()
