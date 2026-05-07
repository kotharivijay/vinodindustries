import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const f = await prisma.finishEntry.findFirst({
  where: { slipNo: 151 },
  include: { lots: { orderBy: { id: 'asc' } } },
})
if (!f) { console.log('FP-151 not found'); process.exit(0) }
console.log(`=== FP-151 (entryId=${f.id}) ===`)
console.log(`finishThan=${f.finishThan}  total=${f.lots.reduce((s, l) => s + l.than, 0)}`)
console.log('FP Lots:')
for (const l of f.lots) console.log(`  ${l.lotNo} / ${l.than}  status=${l.status}`)

const lotNos = f.lots.map(l => l.lotNo)
const dyeings = await prisma.dyeingEntry.findMany({
  where: { OR: [{ lotNo: { in: lotNos } }, { lots: { some: { lotNo: { in: lotNos } } } }] },
  select: {
    slipNo: true, shadeName: true,
    lots: { select: { lotNo: true, than: true } },
    foldBatch: { select: { foldProgram: { select: { foldNo: true } } } },
  },
  orderBy: { slipNo: 'desc' },
})
console.log(`\nCandidate dyeing slips (${dyeings.length}):`)
for (const d of dyeings) {
  console.log(`  slip ${d.slipNo}  fold=${d.foldBatch?.foldProgram?.foldNo}  shade=${d.shadeName}  lots=${d.lots.map(l => `${l.lotNo}/${l.than}`).join(', ')}`)
}

console.log('\n--- per-lot allocation tracker ---')
const need = new Map(f.lots.map(l => [l.lotNo.toLowerCase(), l.than]))
const hits = new Map(f.lots.map(l => [l.lotNo.toLowerCase(), 0]))
for (const d of dyeings) {
  for (const dl of d.lots) {
    const k = dl.lotNo.toLowerCase()
    if (need.has(k)) hits.set(k, (hits.get(k) || 0) + dl.than)
  }
}
for (const [k, n] of need) console.log(`  ${k}: need=${n}, dye-supply=${hits.get(k) || 0}`)

await prisma.$disconnect()
