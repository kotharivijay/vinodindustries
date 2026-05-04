// One-shot: delete Fold 89 batches 14 and 15 (no dyeing slips linked).
// foldBatchLot ids: 1654-1661 (8 rows)
// FoldBatch ids: 1196 (batch 14), 1197 (batch 15)
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const FOLD_BATCH_LOT_IDS = [1654, 1655, 1656, 1657, 1658, 1659, 1660, 1661]
const FOLD_BATCH_IDS = [1196, 1197]

async function main() {
  // Inspect first
  const lots = await prisma.foldBatchLot.findMany({
    where: { id: { in: FOLD_BATCH_LOT_IDS } },
    select: { id: true, lotNo: true, than: true, foldBatchId: true },
    orderBy: { id: 'asc' },
  })
  const batches = await prisma.foldBatch.findMany({
    where: { id: { in: FOLD_BATCH_IDS } },
    select: {
      id: true,
      batchNo: true,
      foldProgram: { select: { foldNo: true } },
      dyeingEntries: { select: { id: true, slipNo: true } },
    },
  })

  console.log('--- Pre-delete inspection ---')
  console.log('FoldBatchLot rows found:', lots.length)
  for (const l of lots) console.log(`  id=${l.id} lot=${l.lotNo} than=${l.than} foldBatchId=${l.foldBatchId}`)
  console.log('FoldBatch rows found:', batches.length)
  for (const b of batches) {
    console.log(`  id=${b.id} fold=${b.foldProgram?.foldNo} batchNo=${b.batchNo} dyeingSlips=${b.dyeingEntries.length}`)
    if (b.dyeingEntries.length) {
      console.log('   ABORT: this batch has linked dyeing slips')
      process.exit(1)
    }
  }
  if (lots.length !== 8 || batches.length !== 2) {
    console.log('Row count mismatch — aborting to be safe')
    process.exit(1)
  }

  console.log('\n--- Deleting ---')
  const r1 = await prisma.foldBatchLot.deleteMany({ where: { id: { in: FOLD_BATCH_LOT_IDS } } })
  console.log('foldBatchLot deleted:', r1.count)
  const r2 = await prisma.foldBatch.deleteMany({ where: { id: { in: FOLD_BATCH_IDS } } })
  console.log('FoldBatch deleted:', r2.count)
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
