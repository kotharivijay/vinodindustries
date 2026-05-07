import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const target = await prisma.greyEntry.findUnique({
  where: { id: 5999 },
  select: { id: true, sn: true, lotNo: true, challanNo: true, than: true, party: { select: { name: true } } },
})
if (!target) { console.log('Row 5999 not found.'); await prisma.$disconnect(); process.exit(0) }
console.log('About to delete:', target)

const r = await prisma.greyEntry.delete({ where: { id: 5999 } })
console.log('Deleted id=', r.id)

const remaining = await prisma.greyEntry.findMany({
  where: { lotNo: { equals: 'PS-110', mode: 'insensitive' } },
  select: { id: true, sn: true, challanNo: true, than: true },
})
console.log(`\nRemaining PS-110 rows (${remaining.length}):`)
for (const x of remaining) console.log(`  id=${x.id} sn=${x.sn} ch=${x.challanNo} than=${x.than}`)
await prisma.$disconnect()
