import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const all = await prisma.greyEntry.findMany({
  where: { startStage: { not: null } },
  select: { id: true, lotNo: true, than: true, startStage: true, party: { select: { name: true } } },
  orderBy: { lotNo: 'asc' },
})
const byStage = new Map()
let totalThan = 0
for (const r of all) {
  byStage.set(r.startStage, (byStage.get(r.startStage) || 0) + 1)
  totalThan += r.than
}
console.log(`Rows with startStage set: ${all.length} (${totalThan} than)`)
for (const [s, n] of byStage) console.log(`  startStage='${s}': ${n} rows`)
console.log('\nSample (first 15):')
for (const r of all.slice(0, 15)) {
  console.log(`  id=${r.id} lot=${r.lotNo} than=${r.than} stage=${r.startStage} party=${r.party?.name}`)
}
await prisma.$disconnect()
