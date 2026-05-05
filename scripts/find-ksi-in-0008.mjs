import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const challan = await prisma.invChallan.findUnique({
  where: { seriesFy_internalSeriesNo: { seriesFy: '2026-27', internalSeriesNo: 8 } },
  include: {
    party: { select: { id: true, displayName: true } },
    lines: { select: { id: true, item: { select: { displayName: true } }, qty: true, unit: true, rate: true, amount: true } },
    invoiceLink: { include: { invoice: { select: { id: true, supplierInvoiceNo: true, status: true, tallyVoucherGuid: true } } } },
  },
})
if (!challan) { console.log('Challan KSI/IN/2026-27/0008 not found'); process.exit(0) }
console.log(`id=${challan.id}  challanNo=${challan.challanNo}  date=${challan.challanDate.toISOString().slice(0,10)}`)
console.log(`status=${challan.status}  party=${challan.party.displayName}`)
console.log(`totalQty=${challan.totalQty}  totalAmount=${challan.totalAmount}  totalWithGst=${challan.totalWithGst}`)
console.log('Lines:')
for (const l of challan.lines) console.log(`  ${l.id}: ${l.item?.displayName} ${l.qty} ${l.unit} @ ${l.rate} = ${l.amount}`)
if (challan.invoiceLink) {
  console.log('LINKED INVOICE:', JSON.stringify(challan.invoiceLink.invoice, null, 2))
} else {
  console.log('No invoice linked.')
}
await prisma.$disconnect()
