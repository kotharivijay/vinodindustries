// Inventory of every RE-PRO lot + how many cascade references each has.
// Read-only — does not modify anything.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const db = prisma

async function countCascades(reproNo) {
  const [foldBatch, dyeingParent, dyeingChild, finishParent, finishChild, despatchParent, despatchChild, foldingSlipLot, packingLot] = await Promise.all([
    db.foldBatchLot.count({ where: { lotNo: reproNo } }),
    db.dyeingEntry.count({ where: { lotNo: reproNo } }),
    db.dyeingEntryLot.count({ where: { lotNo: reproNo } }),
    db.finishEntry.count({ where: { lotNo: reproNo } }),
    db.finishEntryLot.count({ where: { lotNo: reproNo } }),
    db.despatchEntry.count({ where: { lotNo: reproNo } }),
    db.despatchEntryLot.count({ where: { lotNo: reproNo } }),
    db.foldingSlipLot.count({ where: { lotNo: reproNo } }),
    db.packingLot.count({ where: { lotNo: reproNo } }),
  ])
  return { foldBatch, dyeingParent, dyeingChild, finishParent, finishChild, despatchParent, despatchChild, foldingSlipLot, packingLot }
}

async function main() {
  const all = await db.reProcessLot.findMany({
    orderBy: { reproNo: 'asc' },
    select: { id: true, reproNo: true, totalThan: true, status: true, quality: true, createdAt: true, sources: { select: { originalLotNo: true, than: true } } },
  })

  // Sort numerically by the suffix
  all.sort((a, b) => {
    const na = parseInt((a.reproNo || '').split('-').pop() || '0', 10)
    const nb = parseInt((b.reproNo || '').split('-').pop() || '0', 10)
    return na - nb
  })

  console.log(`Total RE-PRO lots: ${all.length}\n`)
  console.log('No.        | Than | Status     | Quality                | FBL | DyP/Ch | FinP/Ch | DespP/Ch | FSL | Pack | Created')
  console.log('-'.repeat(150))

  for (const r of all) {
    const c = await countCascades(r.reproNo)
    const cascade = `${String(c.foldBatch).padStart(3)} | ${String(c.dyeingParent).padStart(3)}/${String(c.dyeingChild).padStart(2)} | ${String(c.finishParent).padStart(3)}/${String(c.finishChild).padStart(2)} | ${String(c.despatchParent).padStart(3)}/${String(c.despatchChild).padStart(2)} | ${String(c.foldingSlipLot).padStart(3)} | ${String(c.packingLot).padStart(3)}`
    console.log(`${r.reproNo.padEnd(11)}| ${String(r.totalThan).padStart(4)} | ${r.status.padEnd(10)} | ${(r.quality || '').slice(0, 22).padEnd(22)} | ${cascade} | ${r.createdAt.toISOString().slice(0, 10)}`)
  }

  // Detect numbering gaps
  const nums = all.map(r => parseInt((r.reproNo || '').split('-').pop() || '0', 10)).filter(n => n > 0).sort((a, b) => a - b)
  const min = nums[0], max = nums[nums.length - 1]
  const present = new Set(nums)
  const gaps = []
  for (let n = min; n <= max; n++) if (!present.has(n)) gaps.push(n)
  console.log(`\nNumber range: ${min} … ${max}`)
  console.log(`Gaps: ${gaps.length ? gaps.map(n => `RE-PRO-${n}`).join(', ') : 'none'}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
