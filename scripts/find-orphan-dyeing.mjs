// Diagnose orphan dyeing slips after a FoldBatch (or whole FoldProgram) was
// deleted. Three scenarios to surface:
//
//   A. foldBatchId points to a row that no longer exists (broken FK).
//      Postgres should have prevented this unless the delete cascaded the FK
//      to NULL, but we check defensively.
//   B. foldBatchId is NULL but the slip looks fold-batched (has lots, isPcJob
//      false, has shadeName matching a fold batch shade) — suggests the FK
//      was nulled when its FoldBatch was deleted.
//   C. foldBatchId is NULL on a slip that's genuinely a direct/PC-job dye —
//      not an orphan; ignore.
//
// Then count unused FoldBatch rows (no dyeingEntries linked) so we know the
// reuse pool.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const allEntries = await prisma.dyeingEntry.findMany({
  select: {
    id: true, slipNo: true, date: true, foldBatchId: true,
    isPcJob: true, shadeName: true, lotNo: true, than: true,
    lots: { select: { lotNo: true, than: true } },
  },
  orderBy: [{ date: 'asc' }, { id: 'asc' }],
})

const allBatches = await prisma.foldBatch.findMany({
  select: {
    id: true, batchNo: true,
    foldProgram: { select: { id: true, foldNo: true, date: true } },
    shade: { select: { id: true, name: true } },
    shadeName: true,
    lots: { select: { lotNo: true, than: true } },
    dyeingEntries: { select: { id: true } },
  },
})

const batchIds = new Set(allBatches.map(b => b.id))

// Scenario A
const danglingFk = allEntries.filter(e => e.foldBatchId != null && !batchIds.has(e.foldBatchId))
// Scenario B candidates
const nullButLooksFolded = allEntries.filter(e => !e.foldBatchId && !e.isPcJob)
// Scenario C
const directOrPc = allEntries.filter(e => !e.foldBatchId && e.isPcJob)

console.log('=== Dyeing slip scope ===')
console.log(`Total dyeing slips: ${allEntries.length}`)
console.log(`Has foldBatchId pointing to a row that exists: ${allEntries.filter(e => e.foldBatchId && batchIds.has(e.foldBatchId)).length}`)
console.log(`Has foldBatchId pointing to MISSING batch (orphan A): ${danglingFk.length}`)
console.log(`No foldBatchId but isPcJob=false (orphan B suspect): ${nullButLooksFolded.length}`)
console.log(`No foldBatchId AND isPcJob=true (direct/PC, NOT an orphan): ${directOrPc.length}`)

if (danglingFk.length) {
  console.log('\n=== Scenario A — dangling FK (slip points to a deleted batch) ===')
  for (const e of danglingFk.slice(0, 30)) {
    console.log(`  slip ${e.slipNo} (id=${e.id})  date=${e.date.toISOString().slice(0,10)}  shade=${e.shadeName}  fbId=${e.foldBatchId}  lots=${e.lots.map(l => `${l.lotNo}/${l.than}`).join(', ') || `${e.lotNo}/${e.than}`}`)
  }
}

if (nullButLooksFolded.length) {
  console.log('\n=== Scenario B — null FK, looks like it WAS folded ===')
  for (const e of nullButLooksFolded.slice(0, 30)) {
    console.log(`  slip ${e.slipNo} (id=${e.id})  date=${e.date.toISOString().slice(0,10)}  shade=${e.shadeName}  lots=${e.lots.map(l => `${l.lotNo}/${l.than}`).join(', ') || `${e.lotNo}/${e.than}`}`)
  }
}

const unusedBatches = allBatches.filter(b => b.dyeingEntries.length === 0)
console.log(`\n=== Reuse pool — fold batches WITHOUT a dyeing slip (${unusedBatches.length}) ===`)
for (const b of unusedBatches.slice(0, 30)) {
  console.log(`  batch ${b.id}  fold=${b.foldProgram?.foldNo} batchNo=${b.batchNo}  shade=${b.shade?.name || b.shadeName}  date=${b.foldProgram?.date?.toISOString().slice(0,10)}  lots=${b.lots.map(l => `${l.lotNo}/${l.than}`).join(', ')}`)
}

await prisma.$disconnect()
