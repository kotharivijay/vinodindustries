// Dump everything we have on a single lot so we can see why a stage chip is wrong.
// Run: node scripts/debug-lot-stages.mjs <lotNo>
import { PrismaClient } from '@prisma/client'

const lotNo = process.argv[2] || 'SSF-1730'
const prisma = new PrismaClient()

async function main() {
  console.log(`Looking up lot: ${lotNo}\n`)

  const ob = await prisma.lotOpeningBalance.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
  })
  console.log('LotOpeningBalance:', ob ? `openingThan=${ob.openingThan} totalDespatched=${ob.totalDespatched ?? 0}` : '— none —')

  if (ob) {
    const allocs = await prisma.lotOpeningBalanceAllocation.findMany({
      where: { balanceId: ob.id },
      select: { stage: true, than: true, notes: true },
    })
    console.log(`LotOpeningBalanceAllocation: ${allocs.length} rows`)
    allocs.forEach(a => console.log(`   stage=${a.stage} than=${a.than} notes=${a.notes ?? ''}`))
  }

  const grey = await prisma.greyEntry.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, than: true, date: true },
  })
  console.log(`GreyEntry: ${grey.length} rows, sum than=${grey.reduce((s, g) => s + g.than, 0)}`)

  const dye = await prisma.dyeingEntryLot.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, than: true, entry: { select: { id: true, foldBatchId: true } } },
  })
  console.log(`DyeingEntryLot: ${dye.length} rows, sum than=${dye.reduce((s, d) => s + d.than, 0)}`)

  const fin = await prisma.finishEntryLot.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, than: true },
  })
  console.log(`FinishEntryLot: ${fin.length} rows, sum than=${fin.reduce((s, f) => s + f.than, 0)}`)

  const fold = await prisma.foldBatchLot.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, than: true },
  })
  console.log(`FoldBatchLot: ${fold.length} rows, sum than=${fold.reduce((s, f) => s + f.than, 0)}`)

  const folding = await prisma.foldingSlipLot.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, than: true, foldingSlip: { select: { slipNo: true, status: true } } },
  })
  console.log(`FoldingSlipLot: ${folding.length} rows, sum than=${folding.reduce((s, f) => s + f.than, 0)}`)
  folding.forEach(f => console.log(`   slip=${f.foldingSlip?.slipNo} status=${f.foldingSlip?.status} than=${f.than}`))

  const pack = await prisma.packingLot.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, than: true },
  })
  console.log(`PackingLot: ${pack.length} rows, sum than=${pack.reduce((s, p) => s + p.than, 0)}`)

  const desp1 = await prisma.despatchEntry.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' }, despatchLots: { none: {} } },
    select: { id: true, than: true },
  })
  const desp2 = await prisma.despatchEntryLot.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, than: true },
  })
  const carryDesp = await prisma.lotCarryForwardDespatch.findMany({
    where: { balance: { lotNo: { equals: lotNo, mode: 'insensitive' } } },
    select: { than: true, challanNo: true, setNo: true },
  })
  console.log(`Despatch: parent=${desp1.length} (${desp1.reduce((s, d) => s + d.than, 0)}) + child=${desp2.length} (${desp2.reduce((s, d) => s + d.than, 0)}) + carryForward=${carryDesp.length} (${carryDesp.reduce((s, d) => s + (d.than || 0), 0)})`)

  console.log('\n→ stagesFor() math:')
  const dyed = dye.reduce((s, d) => s + d.than, 0)
  const finished = fin.reduce((s, f) => s + f.than, 0)
  const foldQueued = fold.reduce((s, f) => s + f.than, 0)
  const foldingActive = folding.reduce((s, f) => s + f.than, 0)
  const packed = pack.reduce((s, p) => s + p.than, 0)
  const despatched = desp1.reduce((s, d) => s + d.than, 0) + desp2.reduce((s, d) => s + d.than, 0)
  const stock = (ob?.openingThan ?? 0) + grey.reduce((s, g) => s + g.than, 0) - despatched
  console.log(`   stock = ${(ob?.openingThan ?? 0)} OB + ${grey.reduce((s, g) => s + g.than, 0)} grey − ${despatched} despatched = ${stock}`)
  const inPack = Math.max(0, packed - despatched)
  const inFolding = Math.max(0, foldingActive - packed)
  const inFinish = Math.max(0, finished - foldingActive - 0)
  const inDye = Math.max(0, dyed - finished)
  const inFold = Math.max(0, foldQueued - dyed)
  const consumed = inPack + inFolding + inFinish + inDye + inFold
  const inGrey = Math.max(0, stock - consumed)
  console.log(`   Grey ${inGrey} · Fold ${inFold} · Dye ${inDye} · Finish ${inFinish} · Folding ${inFolding} · Pack ${inPack}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
