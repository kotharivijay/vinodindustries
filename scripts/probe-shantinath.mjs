// One-shot probe: list every distinct partyName variant containing
// "shantinath" across KsiSalesInvoice + KsiHdfcReceipt + TallyLedger so
// we can see if the duplicate is at source (Tally) or a sync-mapping bug.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const variants = await db.ksiSalesInvoice.groupBy({
  by: ['partyName'],
  where: { partyName: { contains: 'shantinath', mode: 'insensitive' } },
  _count: { _all: true },
  _sum: { totalAmount: true },
})
console.log('\nKsiSalesInvoice variants:')
for (const v of variants) {
  console.log(`  [${v._count._all}x]  "${v.partyName}"  total=${v._sum.totalAmount}`)
  console.log(`         hex first 60: ${Buffer.from(v.partyName).slice(0, 60).toString('hex')}`)
}

const rcptVariants = await db.ksiHdfcReceipt.groupBy({
  by: ['partyName'],
  where: { partyName: { contains: 'shantinath', mode: 'insensitive' } },
  _count: { _all: true },
})
console.log('\nKsiHdfcReceipt variants:')
for (const v of rcptVariants) {
  console.log(`  [${v._count._all}x]  "${v.partyName}"`)
}

const ledgerVariants = await db.tallyLedger.findMany({
  where: { name: { contains: 'shantinath', mode: 'insensitive' } },
  select: { id: true, firmCode: true, name: true, parent: true, mobileNos: true, tags: true },
})
console.log('\nTallyLedger variants:')
for (const l of ledgerVariants) {
  console.log(`  id=${l.id}  firm=${l.firmCode}  "${l.name}"  parent="${l.parent}"  tags=${JSON.stringify(l.tags)}`)
}

await db.$disconnect()
