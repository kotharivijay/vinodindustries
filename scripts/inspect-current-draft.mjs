import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const drafts = await prisma.invPurchaseInvoice.findMany({
  where: { status: 'Draft' },
  include: {
    party: { select: { displayName: true, state: true } },
    lines: { include: { item: { include: { alias: { select: { gstRate: true, tallyStockItem: true } } } } } },
  },
})
for (const inv of drafts) {
  console.log(`\n=== Invoice id=${inv.id} ${inv.supplierInvoiceNo} party=${inv.party.displayName} ===`)
  console.log(`taxable=${inv.taxableAmount} cgst=${inv.cgstAmount} sgst=${inv.sgstAmount} igst=${inv.igstAmount} total=${inv.totalAmount}`)
  for (const l of inv.lines) {
    console.log(`  line ${l.lineNo}: ${l.item?.displayName} qty=${l.qty} ${l.unit} @ ${l.rate}  gstRate=${l.gstRate}  gstAmt=${l.gstAmount}  amount=${l.amount}  total=${l.total}  alias.gst=${l.item?.alias?.gstRate}`)
  }
}
await prisma.$disconnect()
