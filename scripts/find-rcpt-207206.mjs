// Where exactly is 207206 stored? Try vchNumber, instrumentNo, bankRef, and
// also list every Shantinath receipt around 27/3/26 in case the user is
// referring to it by a different label.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

console.log('— Search for 207206 in any text field of KsiHdfcReceipt —\n')
const hits = await db.ksiHdfcReceipt.findMany({
  where: {
    OR: [
      { vchNumber: { contains: '207206' } },
      { instrumentNo: { contains: '207206' } },
      { bankRef: { contains: '207206' } },
      { narration: { contains: '207206' } },
    ],
  },
  select: { id: true, vchNumber: true, vchType: true, date: true, partyName: true, amount: true, bankRef: true, instrumentNo: true, narration: true },
})
for (const r of hits) {
  console.log(`  id=${r.id}  ${r.vchType} ${r.vchNumber}  ${r.date.toISOString().slice(0, 10)}  ₹${r.amount}  party="${r.partyName}"  bankRef=${r.bankRef}  instr=${r.instrumentNo}`)
}
if (hits.length === 0) console.log('  (no row contains 207206 in vchNumber / instrumentNo / bankRef / narration)\n')

console.log('\n— All Shantinath receipts (any vch) within 7 days of 2026-03-27 —\n')
const around = await db.ksiHdfcReceipt.findMany({
  where: {
    partyName: { contains: 'shantinath', mode: 'insensitive' },
    date: { gte: new Date('2026-03-20'), lte: new Date('2026-04-03') },
  },
  select: { id: true, vchNumber: true, vchType: true, date: true, amount: true, bankRef: true, instrumentNo: true, narration: true },
  orderBy: { date: 'asc' },
})
for (const r of around) {
  console.log(`  id=${r.id}  ${r.vchType} vch=${r.vchNumber}  ${r.date.toISOString().slice(0, 10)}  ₹${r.amount}`)
  console.log(`        bankRef=${r.bankRef || '—'}  instr=${r.instrumentNo || '—'}`)
  if (r.narration) console.log(`        narr: ${r.narration.slice(0, 120)}`)
}

await db.$disconnect()
