import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const ls = await prisma.tallyLedger.findMany({
  where: { OR: [
    { name: { contains: 'sohani', mode: 'insensitive' } },
    { name: { contains: 'sohni', mode: 'insensitive' } },
    { name: { contains: 'sohan', mode: 'insensitive' } },
  ]},
  select: { name: true, parent: true },
})
console.log('TallyLedger matches:')
for (const l of ls) console.log(`  ${l.name}  [${l.parent}]`)
await prisma.$disconnect()
