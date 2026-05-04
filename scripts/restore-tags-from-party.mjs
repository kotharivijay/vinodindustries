// Best-effort tag restore: Party.tag is preserved across syncs (separate table),
// so we can mirror those onto TallyLedger.tags by matching name.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')

const taggedParties = await prisma.party.findMany({
  where: { tag: { not: null } },
  select: { name: true, tag: true },
})
console.log(`Found ${taggedParties.length} tagged parties to mirror.`)

let updated = 0, missing = 0
for (const p of taggedParties) {
  const led = await prisma.tallyLedger.findFirst({
    where: { firmCode: 'KSI', name: p.name },
    select: { id: true, name: true, tags: true },
  })
  if (!led) { missing++; console.log(`  miss: ${p.name}`); continue }
  if (led.tags.includes(p.tag)) continue
  console.log(`  ${p.name}  → tag '${p.tag}'`)
  if (APPLY) {
    await prisma.tallyLedger.update({
      where: { id: led.id },
      data: { tags: [...led.tags, p.tag] },
    })
    updated++
  }
}
console.log(`\n${APPLY ? 'Applied' : 'Dry-run'}: ${updated} updated, ${missing} missing.`)
if (!APPLY) console.log('Pass --apply to commit.')
await prisma.$disconnect()
