// Run the same query the print-data route runs, then call the allocator
// inline (replicate logic since it's TS). Compare against what's shown.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function allocate(fpLots, dyeingEntries) {
  const remaining = new Map()
  const originalCasing = new Map()
  for (const fl of fpLots) {
    const k = fl.lotNo.toLowerCase()
    remaining.set(k, Number(fl.than))
    originalCasing.set(k, fl.lotNo)
  }
  const entries = [...dyeingEntries].sort((a, b) => b.slipNo - a.slipNo)
  const allocs = new Map()

  // Pass 1: whole-take
  for (const de of entries) {
    for (const dl of de.lots || []) {
      const k = dl.lotNo.toLowerCase()
      const rem = remaining.get(k) ?? 0
      if (rem <= 0) continue
      const slipThan = Number(dl.than) || 0
      if (slipThan <= 0 || slipThan > rem) continue
      let bucket = allocs.get(de.slipNo)
      if (!bucket) { bucket = { lots: new Map() }; allocs.set(de.slipNo, bucket) }
      bucket.lots.set(k, (bucket.lots.get(k) ?? 0) + slipThan)
      remaining.set(k, rem - slipThan)
    }
  }
  console.log('After pass 1, remaining:', Object.fromEntries(remaining))

  // Pass 2: partial
  for (const [k, rem] of remaining) {
    if (rem <= 0) continue
    let stillNeeded = rem
    for (const de of entries) {
      if (stillNeeded <= 0) break
      const dl = (de.lots || []).find(l => l.lotNo.toLowerCase() === k)
      if (!dl) continue
      const dyeingTotal = Number(dl.than) || 0
      if (dyeingTotal <= 0) continue
      const alreadyHere = allocs.get(de.slipNo)?.lots.get(k) ?? 0
      const leftover = dyeingTotal - alreadyHere
      if (leftover <= 0) continue
      const take = Math.min(leftover, stillNeeded)
      let bucket = allocs.get(de.slipNo)
      if (!bucket) { bucket = { lots: new Map() }; allocs.set(de.slipNo, bucket) }
      bucket.lots.set(k, alreadyHere + take)
      stillNeeded -= take
    }
    remaining.set(k, stillNeeded)
  }
  console.log('After pass 2, remaining:', Object.fromEntries(remaining))

  return allocs
}

async function main() {
  const f = await prisma.finishEntry.findFirst({
    where: { slipNo: 152 },
    include: { lots: true },
  })
  if (!f) { console.log('Not found'); return }

  const fpLots = f.lots.length ? f.lots : [{ lotNo: f.lotNo, than: f.than }]
  const lotNos = [...new Set(fpLots.map(l => l.lotNo))]
  console.log('FP lots:', fpLots.map(l => `${l.lotNo}/${l.than}`).join(', '))
  console.log('lotNos for query:', lotNos)

  const dyeingEntries = await prisma.dyeingEntry.findMany({
    where: {
      OR: [
        { lotNo: { in: lotNos } },
        { lots: { some: { lotNo: { in: lotNos } } } },
      ],
    },
    select: {
      slipNo: true,
      shadeName: true,
      lots: { select: { lotNo: true, than: true } },
    },
    orderBy: { slipNo: 'desc' },
  })
  console.log(`\n${dyeingEntries.length} candidate dyeing slips returned by query.`)
  for (const de of dyeingEntries) {
    console.log(`  slip ${de.slipNo}  shade=${de.shadeName}  lots=${de.lots.map(l => `${l.lotNo}/${l.than}`).join(', ')}`)
  }

  console.log('\n--- Allocator trace ---')
  const allocs = allocate(
    fpLots.map(l => ({ lotNo: l.lotNo, than: Number(l.than) })),
    dyeingEntries,
  )

  console.log('\nFinal allocations per slip:')
  const sorted = [...allocs.entries()].sort((a, b) => b[0] - a[0])
  for (const [slipNo, b] of sorted) {
    const lots = [...b.lots.entries()].map(([k, t]) => `${k}/${t}`).join(', ')
    console.log(`  slip ${slipNo}: ${lots}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
