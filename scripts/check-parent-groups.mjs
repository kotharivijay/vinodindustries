import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const rows = await prisma.tallyLedger.groupBy({
  by: ['parent'],
  where: { firmCode: 'KSI' },
  _count: { _all: true },
  orderBy: { _count: { name: 'desc' } },
})
for (const r of rows) {
  console.log(`${String(r._count._all).padStart(4)}  ${r.parent}`)
}
await prisma.$disconnect()
