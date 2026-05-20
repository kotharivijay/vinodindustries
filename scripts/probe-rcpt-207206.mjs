// Probe receipt vchNumber=207206 (Shantinath, 27/3/26) and dump every
// allocation row + linked invoice so we can see exactly what's stored vs
// what the UI shows. Read-only.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const rcpts = await db.ksiHdfcReceipt.findMany({
  where: {
    partyName: { contains: 'shantinath', mode: 'insensitive' },
    date: new Date('2026-03-27'),
  },
  include: {
    allocations: {
      include: {
        invoice: { select: { id: true, vchNumber: true, vchType: true, date: true, totalAmount: true, partyName: true } },
      },
    },
  },
})

console.log(`Found ${rcpts.length} receipt row(s) matching vch=207206 + Shantinath\n`)
for (const r of rcpts) {
  console.log(`Receipt id=${r.id}  vch=${r.vchNumber}  type=${r.vchType}  date=${r.date.toISOString().slice(0, 10)}`)
  console.log(`  party: "${r.partyName}"`)
  console.log(`  amount: ${r.amount}  carryOverPriorFy: ${r.carryOverPriorFy || 0}`)
  console.log(`  bankRef: ${r.bankRef || '—'}  instrumentNo: ${r.instrumentNo || '—'}`)
  console.log(`  narration: ${r.narration || '—'}`)
  console.log(`  allocations (${r.allocations.length}):`)
  let totalCash = 0, totalTds = 0, totalDisc = 0
  for (const a of r.allocations) {
    const isCN = a.invoice?.vchType === 'Credit Note'
    const signedCash = isCN ? -a.allocatedAmount : a.allocatedAmount
    totalCash += signedCash
    totalTds += a.tdsAmount || 0
    totalDisc += a.discountAmount || 0
    const invDate = a.invoice?.date ? a.invoice.date.toISOString().slice(0, 10) : '—'
    console.log(`    → ${a.invoice?.vchType || '?'} ${a.invoice?.vchNumber || '?'}  (inv date ${invDate}, total ₹${a.invoice?.totalAmount || 0})`)
    console.log(`        allocated=${a.allocatedAmount}  tds=${a.tdsAmount || 0}  discount=${a.discountAmount || 0}${isCN ? '  [CN — subtracts from cash]' : ''}`)
  }
  console.log(`  Σ allocated cash (signed): ${totalCash.toFixed(2)}`)
  console.log(`  Σ tds:                     ${totalTds.toFixed(2)}`)
  console.log(`  Σ discount:                ${totalDisc.toFixed(2)}`)
  console.log(`  Σ cash + tds + disc:       ${(totalCash + totalTds + totalDisc).toFixed(2)}`)
  console.log(`  unallocated = amount − linkedCash − carryOver = ${r.amount} − ${totalCash.toFixed(2)} − ${r.carryOverPriorFy || 0} = ${(r.amount - totalCash - (r.carryOverPriorFy || 0)).toFixed(2)}\n`)
}

await db.$disconnect()
