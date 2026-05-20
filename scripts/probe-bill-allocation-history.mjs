// For each bill on receipts 50 and 370, list every allocation on that
// invoice with its date so we can mark which receipt was first vs
// subsequent. Read-only.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const billNos = ['KSI/25-26/803', 'KSI/25-26/817', 'KSI/25-26/825', 'KSI/25-26/837', 'KSI/25-26/869', 'KSI/25-26/873']

for (const vn of billNos) {
  const inv = await db.ksiSalesInvoice.findFirst({ where: { vchNumber: vn } })
  if (!inv) { console.log(`${vn}  (not found)`); continue }
  const allocs = await db.ksiReceiptAllocation.findMany({
    where: { invoiceId: inv.id },
    include: { receipt: { select: { vchNumber: true, date: true, partyName: true, amount: true } } },
    orderBy: { receipt: { date: 'asc' } },
  })
  console.log(`\n${vn}  total=₹${inv.totalAmount}  pending=?  (${allocs.length} allocation(s))`)
  let runningPending = inv.totalAmount
  for (const a of allocs) {
    const before = runningPending
    const consumed = (a.allocatedAmount || 0) + (a.tdsAmount || 0) + (a.discountAmount || 0)
    runningPending -= consumed
    console.log(`  rcpt vch=${a.receipt.vchNumber}  ${a.receipt.date.toISOString().slice(0, 10)}  cash=₹${a.allocatedAmount}  tds=₹${a.tdsAmount || 0}  disc=₹${a.discountAmount || 0}  | before=₹${before}  after=₹${runningPending.toFixed(2)}`)
  }
}

await db.$disconnect()
