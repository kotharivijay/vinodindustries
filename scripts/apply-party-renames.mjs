// Apply the 6 confirmed Party renames so they match the canonical
// TallyLedger names. After this runs, those 6 parties will appear in the
// Ledger Tags page, the new-challan party picker, etc.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const RENAMES = [
  { from: 'Prakash shirting',  to: 'Prakash ShIrting (Process)' },
  { from: 'Yash collection',   to: 'Yash Collection (Lucknow)' },
  { from: 'Rathi textile',     to: 'Rathi Textile Mills' },
  { from: 'Mahesh Textile',    to: 'Mahesh Textile (Barmer)' },
  { from: 'Keshav Synthetic',  to: 'Keshav Synthetics (Kanpur)' },
  { from: 'Shri Sohani',       to: 'Shri Sohni Fabric (Lucknow)' },
]

const APPLY = process.argv.includes('--apply')

async function main() {
  // Validate: every target must exist in TallyLedger; the source party must
  // exist; the target name must not already be taken by a different Party.
  let ok = true
  const plans = []
  for (const r of RENAMES) {
    const source = await prisma.party.findUnique({
      where: { name: r.from },
      include: { _count: { select: { greyEntries: true, despatchEntries: true, foldBatchLots: true, finishRecipes: true, finishRecipeTags: true } } },
    })
    const ledger = await prisma.tallyLedger.findFirst({ where: { name: r.to, firmCode: 'KSI' } })
    const targetExists = await prisma.party.findUnique({ where: { name: r.to } })
    const refs = source ? source._count.greyEntries + source._count.despatchEntries + source._count.foldBatchLots + source._count.finishRecipes + source._count.finishRecipeTags : 0
    let issue = null
    if (!source) issue = 'source party not found'
    else if (!ledger) issue = 'TallyLedger target missing'
    else if (targetExists && targetExists.id !== source.id) issue = `target name already used by another Party (id=${targetExists.id})`
    plans.push({ ...r, sourceId: source?.id, refs, issue })
    const label = issue ? `❌ ${issue}` : `→ refs ${refs}`
    console.log(`  [${source?.id ?? '?'}] "${r.from}"  →  "${r.to}"  ${label}`)
    if (issue) ok = false
  }

  if (!ok) {
    console.log('\nFix the issues above before applying.')
    return
  }
  if (!APPLY) {
    console.log('\n[dry-run only — pass --apply to rename]')
    return
  }

  let renamed = 0
  for (const p of plans) {
    await prisma.party.update({ where: { id: p.sourceId }, data: { name: p.to } })
    renamed++
  }
  console.log(`\n✅ Renamed ${renamed} parties.`)
  console.log('All FK references (grey/despatch/fold/finish-recipe rows) follow automatically — no row updates needed.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
