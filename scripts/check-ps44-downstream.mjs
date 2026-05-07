import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const lot = 'PS-44'
const where = { lotNo: { equals: lot, mode: 'insensitive' } }
const [fold, dyeChild, finish, packing, desp, despLot, repro] = await Promise.all([
  prisma.foldBatchLot.count({ where }),
  prisma.dyeingEntryLot.count({ where }),
  prisma.finishEntryLot.count({ where }),
  prisma.packingLot.count({ where }),
  prisma.despatchEntry.count({ where }),
  prisma.despatchEntryLot.count({ where }),
  prisma.reProcessSource.count({ where: { originalLotNo: { equals: lot, mode: 'insensitive' } } }),
])
console.log(`Downstream for ${lot}:`)
console.log(`  foldBatchLot:     ${fold}`)
console.log(`  dyeingEntryLot:   ${dyeChild}`)
console.log(`  finishEntryLot:   ${finish}`)
console.log(`  packingLot:       ${packing}`)
console.log(`  despatchEntry:    ${desp}`)
console.log(`  despatchEntryLot: ${despLot}`)
console.log(`  reProcessSource:  ${repro}`)

// Note: every downstream FK is keyed on lotNo (string), not on a specific
// GreyEntry.id. So duplicate grey rows for the same lotNo BOTH contribute
// "evidence" that the lot exists; deleting one doesn't break any reference.

// (No FK from any other table to GreyEntry.id, so per-row attribution doesn't exist.)

await prisma.$disconnect()
