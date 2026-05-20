// Check whether a Shantinath receipt for ~₹43,086 carries the remaining
// ₹8,888 of KSI/25-26/869. Read-only.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

// Find Shantinath receipts in a ±₹2 window around 43086 (rounding tolerance).
const cands = await db.ksiHdfcReceipt.findMany({
  where: {
    partyName: { contains: 'shantinath', mode: 'insensitive' },
    amount: { gte: 43084, lte: 43088 },
  },
  include: {
    allocations: {
      include: {
        invoice: { select: { id: true, vchNumber: true, vchType: true, date: true, totalAmount: true } },
      },
    },
  },
  orderBy: { date: 'asc' },
})
console.log(`Found ${cands.length} Shantinath receipt(s) with amount ≈ ₹43,086\n`)
for (const r of cands) {
  console.log(`Receipt id=${r.id}  ${r.vchType} vch=${r.vchNumber}  ${r.date.toISOString().slice(0, 10)}  ₹${r.amount}`)
  console.log(`  bankRef=${r.bankRef || '—'}  instr=${r.instrumentNo || '—'}`)
  if (r.narration) console.log(`  narr: ${r.narration.slice(0, 120)}`)
  console.log(`  allocations (${r.allocations.length}):`)
  let cashSum = 0, tdsSum = 0
  for (const a of r.allocations) {
    const tag = a.invoice?.vchNumber === 'KSI/25-26/869' ? '  ★ THE 869 BILL' : ''
    console.log(`    → ${a.invoice?.vchType} ${a.invoice?.vchNumber}  total=₹${a.invoice?.totalAmount}  allocated=₹${a.allocatedAmount}  tds=₹${a.tdsAmount || 0}  disc=₹${a.discountAmount || 0}${tag}`)
    cashSum += a.allocatedAmount || 0
    tdsSum += a.tdsAmount || 0
  }
  console.log(`  Σ cash=${cashSum.toFixed(2)}  Σ tds=${tdsSum.toFixed(2)}\n`)
}

// Also check directly: every allocation against KSI/25-26/869 across ALL receipts.
console.log('— All allocations on KSI/25-26/869 across every receipt —')
const inv869 = await db.ksiSalesInvoice.findFirst({
  where: { vchNumber: 'KSI/25-26/869' },
  select: { id: true, vchNumber: true, totalAmount: true },
})
if (inv869) {
  console.log(`Invoice id=${inv869.id}  ${inv869.vchNumber}  total=₹${inv869.totalAmount}`)
  const allocs = await db.ksiHdfcReceiptAllocation.findMany({
    where: { invoiceId: inv869.id },
    include: { receipt: { select: { id: true, vchNumber: true, date: true, amount: true, partyName: true } } },
  })
  let cashSum = 0, tdsSum = 0, discSum = 0
  for (const a of allocs) {
    console.log(`  ← Receipt vch=${a.receipt.vchNumber}  ${a.receipt.date.toISOString().slice(0, 10)}  rcpt₹${a.receipt.amount}  alloc=₹${a.allocatedAmount}  tds=₹${a.tdsAmount || 0}  disc=₹${a.discountAmount || 0}`)
    cashSum += a.allocatedAmount || 0
    tdsSum += a.tdsAmount || 0
    discSum += a.discountAmount || 0
  }
  const pending = inv869.totalAmount - cashSum - tdsSum - discSum
  console.log(`  Σ allocated cash:  ₹${cashSum.toFixed(2)}`)
  console.log(`  Σ TDS:             ₹${tdsSum.toFixed(2)}`)
  console.log(`  Σ discount:        ₹${discSum.toFixed(2)}`)
  console.log(`  Σ all consumed:    ₹${(cashSum + tdsSum + discSum).toFixed(2)}`)
  console.log(`  Pending on bill:   ₹${pending.toFixed(2)}`)
} else {
  console.log('  KSI/25-26/869 not found')
}

await db.$disconnect()
