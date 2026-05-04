// Swap data between PS-109 (id=5992) and PS-110 (id=5993).
// Step 1: dry-run — show what's there + downstream activity.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')

async function main() {
  const greys = await prisma.greyEntry.findMany({
    where: { lotNo: { in: ['PS-109', 'PS-110'], mode: 'insensitive' } },
    include: { party: true, quality: true, transport: true, weaver: true },
    orderBy: { lotNo: 'asc' },
  })
  console.log('-- GreyEntry rows --')
  for (const g of greys) {
    console.log(`id=${g.id} sn=${g.sn} lot=${g.lotNo}  challan=${g.challanNo}  than=${g.than}  weight=${g.weight}  grayMtr=${g.grayMtr}`)
    console.log(`   weaver=${g.weaver?.name}  viverNameBill=${g.viverNameBill}  marka=${g.marka}  bale=${g.bale} baleNo=${g.baleNo} echBaleThan=${g.echBaleThan}`)
    console.log(`   transport=${g.transport?.name}  transportLrNo=${g.transportLrNo}  lrNo=${g.lrNo}`)
  }

  console.log('\n-- Downstream activity --')
  for (const lot of ['PS-109', 'PS-110']) {
    const fold = await prisma.foldBatchLot.count({ where: { lotNo: { equals: lot, mode: 'insensitive' } } })
    const dye = await prisma.dyeingEntryLot.count({ where: { lotNo: { equals: lot, mode: 'insensitive' } } })
    const finish = await prisma.finishEntryLot.count({ where: { lotNo: { equals: lot, mode: 'insensitive' } } })
    const pack = await prisma.packingLot.count({ where: { lotNo: { equals: lot, mode: 'insensitive' } } })
    const desp = await prisma.despatchEntry.count({ where: { lotNo: { equals: lot, mode: 'insensitive' } } })
    const despLot = await prisma.despatchEntryLot.count({ where: { lotNo: { equals: lot, mode: 'insensitive' } } })
    console.log(`${lot}: fold=${fold} dye=${dye} finish=${finish} pack=${pack} desp=${desp} despLot=${despLot}`)
  }

  if (!APPLY) {
    console.log('\n[dry-run only — pass --apply to swap data]')
    return
  }

  // Apply swap of data fields only (keep lotNo & sn intact so downstream stays mapped)
  if (greys.length !== 2) throw new Error(`Expected 2 rows, got ${greys.length}`)
  const a = greys.find(g => g.lotNo.toUpperCase() === 'PS-109')
  const b = greys.find(g => g.lotNo.toUpperCase() === 'PS-110')
  if (!a || !b) throw new Error('PS-109 or PS-110 missing')

  const fieldsToSwap = [
    'challanNo', 'partyId', 'qualityId', 'weight', 'than', 'grayMtr',
    'transportId', 'transportLrNo', 'bale', 'baleNo', 'echBaleThan',
    'weaverId', 'viverNameBill', 'lrNo', 'marka',
  ]
  const aData = {}
  const bData = {}
  for (const f of fieldsToSwap) {
    aData[f] = b[f]
    bData[f] = a[f]
  }
  // PS-110's actual challan is 168 (matches viver Ramco-168). After swap,
  // that 168 lands on PS-109 row.
  aData.challanNo = 168

  await prisma.$transaction([
    prisma.greyEntry.update({ where: { id: a.id }, data: aData }),
    prisma.greyEntry.update({ where: { id: b.id }, data: bData }),
  ])
  console.log('\nSwapped.')

  const after = await prisma.greyEntry.findMany({
    where: { lotNo: { in: ['PS-109', 'PS-110'], mode: 'insensitive' } },
    select: { id: true, lotNo: true, challanNo: true, than: true, weight: true, grayMtr: true },
    orderBy: { lotNo: 'asc' },
  })
  console.log('-- After --')
  for (const g of after) console.log(`  id=${g.id} lot=${g.lotNo} challan=${g.challanNo} than=${g.than} weight=${g.weight} grayMtr=${g.grayMtr}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
