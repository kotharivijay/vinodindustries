import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const total = await prisma.tallyLedger.count({ where: { firmCode: 'KSI' } })
const tagged = await prisma.tallyLedger.count({
  where: { firmCode: 'KSI', NOT: { tags: { isEmpty: true } } },
})
const sundryDr = await prisma.tallyLedger.count({
  where: { firmCode: 'KSI', parent: { contains: 'Sundry', mode: 'insensitive' } },
})
console.log('KSI ledgers total       :', total)
console.log('KSI ledgers with tags   :', tagged)
console.log('KSI parent contains "Sundry":', sundryDr)

const sample = await prisma.tallyLedger.findMany({
  where: { firmCode: 'KSI', NOT: { tags: { isEmpty: true } } },
  select: { name: true, parent: true, tags: true },
  take: 10,
})
console.log('\nSample tagged ledgers:')
for (const l of sample) console.log(`  ${l.name}  parent="${l.parent}"  tags=${JSON.stringify(l.tags)}`)

const sampleAny = await prisma.tallyLedger.findMany({
  where: { firmCode: 'KSI' },
  select: { name: true, parent: true, tags: true },
  take: 5,
  orderBy: { name: 'asc' },
})
console.log('\nFirst 5 KSI ledgers (any):')
for (const l of sampleAny) console.log(`  ${l.name}  parent="${l.parent}"  tags=${JSON.stringify(l.tags)}`)

await prisma.$disconnect()
