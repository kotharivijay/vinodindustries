// Inspect a specific RE-PRO lot's fields to see why batch weight is still 0.
// Run: node scripts/debug-repro-weight.mjs RE-PRO-20
import { PrismaClient } from '@prisma/client'

const reproNo = process.argv[2] || 'RE-PRO-20'
const prisma = new PrismaClient()

function parseWeightKgPerMtr(s) {
  if (!s) return 0
  const num = parseFloat(String(s).replace(/[^0-9.]/g, ''))
  if (isNaN(num)) return 0
  const grams = num < 1 ? num * 100 : num
  return grams / 1000
}

async function main() {
  const r = await prisma.reProcessLot.findFirst({
    where: { reproNo: { equals: reproNo, mode: 'insensitive' } },
    include: { sources: true },
  })
  if (!r) { console.log(`No ReProcessLot found for "${reproNo}"`); return }

  console.log(`=== ${r.reproNo} ===`)
  console.log(`weight     : ${JSON.stringify(r.weight)}`)
  console.log(`grayMtr    : ${r.grayMtr}`)
  console.log(`totalThan  : ${r.totalThan}`)
  console.log(`quality    : ${r.quality}`)
  console.log(`status     : ${r.status}`)
  console.log(`sources    : ${r.sources.length}`)

  const kgPerMtr = parseWeightKgPerMtr(r.weight)
  console.log(`\nparseWeightKgPerMtr("${r.weight}") = ${kgPerMtr}`)
  console.log(`Conditions for weight calc:`)
  console.log(`  kgPerMtr > 0      : ${kgPerMtr > 0}`)
  console.log(`  grayMtr truthy    : ${!!r.grayMtr}`)
  console.log(`  totalThan > 0     : ${r.totalThan > 0}`)
  if (kgPerMtr > 0 && r.grayMtr && r.totalThan > 0) {
    const wpt = kgPerMtr * r.grayMtr / r.totalThan
    console.log(`  weightPerThan = ${kgPerMtr} × ${r.grayMtr} / ${r.totalThan} = ${wpt} kg`)
  } else {
    console.log(`  → calcWeightPerThan returns 0 (one or more conditions false)`)
  }

  // Check whether this lot is in any FoldBatchLot
  const fbl = await prisma.foldBatchLot.findMany({
    where: { lotNo: { equals: reproNo, mode: 'insensitive' } },
    select: { id: true, lotNo: true, than: true, foldBatch: { select: { batchNo: true, foldProgram: { select: { foldNo: true } } } } },
  })
  console.log(`\nFoldBatchLot rows: ${fbl.length}`)
  for (const f of fbl) {
    console.log(`  fold ${f.foldBatch?.foldProgram?.foldNo} batch ${f.foldBatch?.batchNo}: lotNo="${f.lotNo}" than=${f.than}`)
  }

  // Source meters fallback option
  const totalSourceThan = r.sources.reduce((s, x) => s + (x.than || 0), 0)
  console.log(`\nSource lots: ${r.sources.length}`)
  for (const s of r.sources) {
    console.log(`  ${s.originalLotNo}  than=${s.than}  party=${s.party}`)
  }
  console.log(`Total source than: ${totalSourceThan}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
