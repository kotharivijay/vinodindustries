// Find + optionally delete a DespatchEntry by challanNo + party name (case-insensitive).
// Run dry first:  node scripts/delete-despatch.mjs <challanNo> "<partyName>"
// Apply delete:   node scripts/delete-despatch.mjs <challanNo> "<partyName>" --apply
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const challanNo = parseInt(args[0] || '0', 10)
const partyName = args[1] || ''
if (!challanNo || !partyName) {
  console.error('Usage: node delete-despatch.mjs <challanNo> "<partyName>" [--apply]')
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  // Find party (case-insensitive partial match)
  const parties = await prisma.party.findMany({
    where: { name: { contains: partyName, mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (parties.length === 0) { console.error(`No party matches "${partyName}"`); process.exit(1) }
  console.log(`Party matches: ${parties.map(p => `${p.id} ${p.name}`).join(' | ')}`)

  // Find every DespatchEntry with this challanNo for any matching party
  const entries = await prisma.despatchEntry.findMany({
    where: {
      challanNo,
      partyId: { in: parties.map(p => p.id) },
    },
    include: {
      party: { select: { name: true } },
      quality: { select: { name: true } },
      transport: { select: { name: true } },
      despatchLots: true,
      changeLogs: { select: { id: true } },
    },
  })

  // DespatchNotification has no FK back to DespatchEntry, look up by entryId
  const ids = entries.map(e => e.id)
  const notifs = ids.length
    ? await prisma.despatchNotification.findMany({ where: { entryId: { in: ids } }, select: { id: true, entryId: true } })
    : []
  const notifByEntry = new Map()
  for (const n of notifs) notifByEntry.set(n.entryId, (notifByEntry.get(n.entryId) || 0) + 1)

  if (entries.length === 0) {
    console.log(`No DespatchEntry found with challanNo=${challanNo} for matched parties.`)
    return
  }

  for (const e of entries) {
    console.log('\n--- DespatchEntry ---')
    console.log(`id=${e.id}  date=${e.date.toISOString().slice(0, 10)}  challanNo=${e.challanNo}`)
    console.log(`party=${e.party.name}  quality=${e.quality.name}  transport=${e.transport?.name ?? '—'}`)
    console.log(`lotNo=${e.lotNo}  than=${e.than}  billNo=${e.billNo ?? '—'}  rate=${e.rate ?? '—'}  pTotal=${e.pTotal ?? '—'}`)
    console.log(`despatchLots=${e.despatchLots.length}  changeLogs=${e.changeLogs.length}  notifications=${notifByEntry.get(e.id) || 0}`)
    if (e.despatchLots.length > 0) {
      for (const dl of e.despatchLots) {
        console.log(`   lot row id=${dl.id}  lotNo=${dl.lotNo}  than=${dl.than}  rate=${dl.rate ?? '—'}`)
      }
    }
  }

  if (!APPLY) {
    console.log('\n(dry run — re-run with --apply to delete)')
    return
  }

  console.log('\nDeleting…')
  // Delete child rows first (cascade isn't set on DespatchChangeLog/Notification)
  const [c1, c2, c3, c4] = await prisma.$transaction([
    prisma.despatchEntryLot.deleteMany({ where: { entryId: { in: ids } } }),
    prisma.despatchChangeLog.deleteMany({ where: { entryId: { in: ids } } }),
    prisma.despatchNotification.deleteMany({ where: { entryId: { in: ids } } }),
    prisma.despatchEntry.deleteMany({ where: { id: { in: ids } } }),
  ])
  console.log(`Deleted: lots=${c1.count}, changeLogs=${c2.count}, notifications=${c3.count}, entries=${c4.count}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
