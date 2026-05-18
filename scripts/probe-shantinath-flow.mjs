// One-shot probe: gather inward + outward for "Shri Shantinath Textile Pali Marwar"
// so we can mock up sample reports. Reads only.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const party = await db.party.findFirst({
  where: { name: { contains: 'shantinath', mode: 'insensitive' } },
  select: { id: true, name: true, tag: true, lotPrefixes: true },
})
console.log('Party:', party, '\n')

if (!party) { await db.$disconnect(); process.exit(0) }

// ── Inward (GreyEntry) ───────────────────────────────────────────────
const grey = await db.greyEntry.findMany({
  where: { partyId: party.id },
  select: {
    id: true, date: true, challanNo: true, lotNo: true, than: true, baleNo: true, bale: true,
    transportLrNo: true, marka: true, openedAt: true,
    quality: { select: { name: true } },
  },
  orderBy: { date: 'asc' },
})
const inwardThan = grey.reduce((s, g) => s + g.than, 0)
const inwardLots = new Set(grey.map(g => g.lotNo.toUpperCase()))
console.log(`INWARD: ${grey.length} bale rows, ${inwardLots.size} distinct lots, ${inwardThan} than`)

// ── Outward (DespatchEntry parent + DespatchEntryLot children) ──────
const dParent = await db.despatchEntry.findMany({
  where: { partyId: party.id, despatchLots: { none: {} } },
  select: { id: true, date: true, challanNo: true, lotNo: true, than: true, billNo: true,
    quality: { select: { name: true } }, narration: true },
  orderBy: { date: 'asc' },
})
const dChildren = await db.despatchEntryLot.findMany({
  where: { entry: { partyId: party.id } },
  select: { id: true, lotNo: true, than: true,
    entry: { select: { date: true, challanNo: true, billNo: true } },
    quality: { select: { name: true } } },
  orderBy: { entry: { date: 'asc' } },
})
const outwardThan = dParent.reduce((s, d) => s + d.than, 0) + dChildren.reduce((s, d) => s + d.than, 0)
const outwardRows = dParent.length + dChildren.length
console.log(`OUTWARD: ${outwardRows} rows, ${outwardThan} than\n`)

console.log(`BALANCE (than still with KSI): ${inwardThan - outwardThan}\n`)

// ── Per-lot detail ────────────────────────────────────────────────
const lotMap = new Map() // lotKey → { qualities:Set, inwardThan, outwardThan, inwardDates:[], outwardDates:[], baleNos:Set, lr:Set, lastInward, lastOutward, opened }
const ensure = (k) => {
  if (!lotMap.has(k)) lotMap.set(k, {
    lotNo: k, qualities: new Set(), inward: 0, outward: 0, bales: 0,
    inwardDates: [], outwardDates: [], baleNos: new Set(), lr: new Set(),
    firstInward: null, lastOutward: null, opened: null,
  })
  return lotMap.get(k)
}
for (const g of grey) {
  const r = ensure(g.lotNo.toUpperCase())
  r.qualities.add(g.quality?.name || '')
  r.inward += g.than
  r.bales += 1
  r.inwardDates.push(g.date)
  if (g.baleNo) r.baleNos.add(g.baleNo)
  if (g.transportLrNo) r.lr.add(g.transportLrNo)
  if (!r.firstInward || g.date < r.firstInward) r.firstInward = g.date
  if (g.openedAt && (!r.opened || g.openedAt > r.opened)) r.opened = g.openedAt
}
for (const d of dParent) {
  const r = ensure(d.lotNo.toUpperCase())
  r.qualities.add(d.quality?.name || '')
  r.outward += d.than
  r.outwardDates.push(d.date)
  if (!r.lastOutward || d.date > r.lastOutward) r.lastOutward = d.date
}
for (const d of dChildren) {
  const r = ensure(d.lotNo.toUpperCase())
  r.qualities.add(d.quality?.name || '')
  r.outward += d.than
  r.outwardDates.push(d.entry.date)
  if (!r.lastOutward || d.entry.date > r.lastOutward) r.lastOutward = d.entry.date
}

const perLot = Array.from(lotMap.values()).map(r => ({
  ...r,
  qualities: Array.from(r.qualities).filter(Boolean).join(' / '),
  balance: r.inward - r.outward,
}))
perLot.sort((a, b) => (a.firstInward?.getTime() || 0) - (b.firstInward?.getTime() || 0))

console.log('--- PER LOT ---')
for (const r of perLot) {
  const fi = r.firstInward ? r.firstInward.toISOString().slice(0, 10) : '—'
  const lo = r.lastOutward ? r.lastOutward.toISOString().slice(0, 10) : '—'
  const op = r.opened ? r.opened.toISOString().slice(0, 10) : ''
  console.log(`${r.lotNo}  ${r.qualities}  bales=${r.bales}  inward=${r.inward}  outward=${r.outward}  bal=${r.balance}  first=${fi}  lastOut=${lo}  opened=${op}`)
}

// ── Raw inward + outward rows (chronological) for the ledger-style view ──
console.log('\n--- INWARD ROWS (chronological) ---')
for (const g of grey) {
  console.log(`  ${g.date.toISOString().slice(0, 10)}  ch${g.challanNo}  ${g.lotNo.padEnd(12)}  ${(g.quality?.name || '').padEnd(28)}  than=${String(g.than).padStart(4)}  bale=${g.baleNo || '—'}  LR=${g.transportLrNo || '—'}`)
}
console.log('\n--- OUTWARD ROWS (chronological) ---')
const outAll = [
  ...dParent.map(d => ({ date: d.date, ch: d.challanNo, lot: d.lotNo, quality: d.quality?.name || '', than: d.than, bill: d.billNo, narration: d.narration })),
  ...dChildren.map(d => ({ date: d.entry.date, ch: d.entry.challanNo, lot: d.lotNo, quality: d.quality?.name || '', than: d.than, bill: d.entry.billNo, narration: '' })),
].sort((a, b) => a.date.getTime() - b.date.getTime())
for (const o of outAll) {
  console.log(`  ${o.date.toISOString().slice(0, 10)}  ch${o.ch}  ${o.lot.padEnd(12)}  ${(o.quality || '').padEnd(28)}  than=${String(o.than).padStart(4)}  bill=${o.bill || '—'}`)
}

await db.$disconnect()
