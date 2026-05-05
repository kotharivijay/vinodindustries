import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // FP-152 = FinishEntry.slipNo = 152
  const f = await prisma.finishEntry.findFirst({
    where: { slipNo: 152 },
    include: { lots: { orderBy: { id: 'asc' } } },
  })
  if (!f) { console.log('FP not found'); return }

  console.log(`=== FinishEntry id=${f.id} slipNo=${f.slipNo} date=${f.date.toISOString().slice(0,10)} ===`)
  console.log(`finishThan=${f.finishThan}  meter=${f.meter}  finishMtr=${f.finishMtr}  finishDespSlipNo=${f.finishDespSlipNo}`)
  console.log('FP Lots:')
  for (const l of f.lots) console.log(`  fpLot.lotNo=${l.lotNo}  fpLot.than=${l.than}  doneThan=${l.doneThan}  status=${l.status}`)
  console.log(`FP total than (sum of fpLot.than): ${f.lots.reduce((s, l) => s + l.than, 0)}`)

  // Find dyeing slips that contain any of the FP's lots (no shade filter — finish entries don't store shade)
  const lotNos = [...new Set(f.lots.map(l => l.lotNo))]
  const dyeingSlips = await prisma.dyeingEntry.findMany({
    where: {
      OR: [
        { lotNo: { in: lotNos, mode: 'insensitive' } },
        { lots: { some: { lotNo: { in: lotNos, mode: 'insensitive' } } } },
      ],
    },
    select: {
      id: true, slipNo: true, date: true, lotNo: true, than: true, shadeName: true,
      lots: { select: { lotNo: true, than: true } },
    },
    orderBy: { date: 'desc' },
  })
  console.log(`\nCandidate dyeing slips (lots=${lotNos.join(',')}):`)
  for (const s of dyeingSlips) {
    const lotsStr = s.lots.length
      ? s.lots.map(l => `${l.lotNo}/${l.than}`).join(', ')
      : `${s.lotNo}/${s.than}`
    console.log(`  slip ${s.slipNo} (id=${s.id}, ${s.date.toISOString().slice(0,10)}) shade=${s.shadeName}  ${lotsStr}`)
  }

  // Specifically look up slip 201 + PS-43
  const slip201 = await prisma.dyeingEntry.findFirst({
    where: { slipNo: 201 },
    include: { lots: true },
  })
  console.log(`\nslip 201 (id=${slip201?.id}): shade=${slip201?.shadeName} parent.lotNo=${slip201?.lotNo} parent.than=${slip201?.than}  date=${slip201?.date?.toISOString().slice(0,10)}`)
  for (const l of slip201?.lots ?? []) console.log(`  child: ${l.lotNo} / ${l.than}`)

  const ps43 = await prisma.greyEntry.findMany({
    where: { lotNo: { equals: 'PS-43', mode: 'insensitive' } },
    select: { id: true, sn: true, lotNo: true, than: true, date: true, party: { select: { name: true } } },
  })
  console.log(`\nPS-43 in grey:`)
  for (const g of ps43) console.log(`  id=${g.id} sn=${g.sn} than=${g.than} party=${g.party?.name}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
