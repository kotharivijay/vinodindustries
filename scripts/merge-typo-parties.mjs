// Merge typo Party rows into their canonical TallyLedger-matched siblings.
// All FK references (greyEntry, despatchEntry, foldBatchLot, finishRecipe,
// finishRecipeTag) repoint to the canonical row, then the typo row is deleted.

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const MERGES = [
  { from: 'Prakash shirting',  to: 'Prakash ShIrting (Process)' },
  { from: 'Yash collection',   to: 'Yash Collection (Lucknow)' },
  { from: 'Rathi textile',     to: 'Rathi Textile Mills' },
  { from: 'Mahesh Textile',    to: 'Mahesh Textile (Barmer)' },
  { from: 'Keshav Synthetic',  to: 'Keshav Synthetics (Kanpur)' },
  { from: 'Shri Sohani',       to: 'Shri Sohni Fabric (Lucknow)' },
]

const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(APPLY ? '=== MERGING ===' : '=== DRY-RUN ===')
  let totalMoves = 0, dropped = 0
  for (const m of MERGES) {
    const source = await prisma.party.findUnique({ where: { name: m.from } })
    const target = await prisma.party.findUnique({ where: { name: m.to } })
    if (!source) { console.log(`  ⚠ source "${m.from}" missing — skipping`); continue }
    if (!target) { console.log(`  ⚠ target "${m.to}" missing — skipping`); continue }
    if (source.id === target.id) { console.log(`  ⚠ same row — skipping`); continue }

    // Count refs on the source so we can report what'll move
    const counts = await Promise.all([
      prisma.greyEntry.count({ where: { partyId: source.id } }),
      prisma.despatchEntry.count({ where: { partyId: source.id } }),
      prisma.foldBatchLot.count({ where: { partyId: source.id } }),
      prisma.finishRecipe.count({ where: { partyId: source.id } }),
      prisma.finishRecipeTag.count({ where: { partyId: source.id } }),
    ])
    const [g, d, f, fr, frt] = counts
    const refs = g + d + f + fr + frt
    console.log(`  [${source.id}] "${m.from}" → [${target.id}] "${m.to}"   refs: g=${g} d=${d} f=${f} fr=${fr} frt=${frt} (total ${refs})`)

    if (!APPLY) continue

    await prisma.$transaction([
      prisma.greyEntry.updateMany({ where: { partyId: source.id }, data: { partyId: target.id } }),
      prisma.despatchEntry.updateMany({ where: { partyId: source.id }, data: { partyId: target.id } }),
      prisma.foldBatchLot.updateMany({ where: { partyId: source.id }, data: { partyId: target.id } }),
      prisma.finishRecipe.updateMany({ where: { partyId: source.id }, data: { partyId: target.id } }),
      prisma.finishRecipeTag.updateMany({ where: { partyId: source.id }, data: { partyId: target.id } }),
      prisma.party.delete({ where: { id: source.id } }),
    ])
    totalMoves += refs
    dropped++
    console.log(`     ✓ moved ${refs} refs, deleted source [${source.id}]`)
  }
  if (APPLY) {
    console.log(`\n✅ Done. Moved ${totalMoves} references, deleted ${dropped} typo parties.`)
  } else {
    console.log(`\n[dry-run only — pass --apply to merge]`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
