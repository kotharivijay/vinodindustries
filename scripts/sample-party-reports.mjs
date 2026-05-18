// Generate 3 sample PDF report layouts for one party so the operator can
// pick a favourite before we wire one into the app.
//
//   A: Summary       — totals + per-lot table (most compact, 1 page)
//   B: Ledger        — chronological transactions with running balance
//   C: Lot-wise      — per-lot section with inward bale list + every outward
//
// USAGE
//   node scripts/sample-party-reports.mjs            # → temp/shantinath-A.pdf, -B.pdf, -C.pdf
//   node scripts/sample-party-reports.mjs <partyId>  # any party
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const db = new PrismaClient()
const OUT_DIR = path.resolve('temp')
fs.mkdirSync(OUT_DIR, { recursive: true })

const partyIdArg = process.argv[2]
const party = partyIdArg
  ? await db.party.findUnique({ where: { id: Number(partyIdArg) } })
  : await db.party.findFirst({ where: { name: { contains: 'shantinath', mode: 'insensitive' } } })
if (!party) { console.error('No matching party'); process.exit(1) }

const fmt = (d) => d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '—'
const cleanName = party.name.replace(/\s+/g, ' ').trim()
console.log(`Generating reports for: ${cleanName} (id=${party.id})`)

// ── Pull inward + outward ──────────────────────────────────────────
const grey = await db.greyEntry.findMany({
  where: { partyId: party.id },
  select: {
    id: true, date: true, challanNo: true, lotNo: true, than: true,
    baleNo: true, transportLrNo: true, marka: true, openedAt: true,
    quality: { select: { name: true } },
  },
  orderBy: { date: 'asc' },
})
const dParent = await db.despatchEntry.findMany({
  where: { partyId: party.id, despatchLots: { none: {} } },
  select: { id: true, date: true, challanNo: true, lotNo: true, than: true, billNo: true,
    quality: { select: { name: true } } },
})
const dChildren = await db.despatchEntryLot.findMany({
  where: { entry: { partyId: party.id } },
  select: { id: true, lotNo: true, than: true,
    entry: { select: { date: true, challanNo: true, billNo: true } },
    quality: { select: { name: true } } },
})

const outwardRows = [
  ...dParent.map(d => ({ date: d.date, ch: d.challanNo, lot: d.lotNo, quality: d.quality?.name || '', than: d.than, bill: d.billNo })),
  ...dChildren.map(d => ({ date: d.entry.date, ch: d.entry.challanNo, lot: d.lotNo, quality: d.quality?.name || '', than: d.than, bill: d.entry.billNo })),
].sort((a, b) => a.date.getTime() - b.date.getTime())
const inwardThan = grey.reduce((s, g) => s + g.than, 0)
const outwardThan = outwardRows.reduce((s, d) => s + d.than, 0)
const balanceThan = inwardThan - outwardThan

// ── Build per-lot summary (used by A + C) ──────────────────────────
const lotMap = new Map()
const ensure = (key) => {
  if (!lotMap.has(key)) lotMap.set(key, {
    lotNo: key, quality: '', inward: 0, outward: 0,
    inwardRows: [], outwardRows: [], firstInward: null, lastOut: null,
  })
  return lotMap.get(key)
}
for (const g of grey) {
  const r = ensure(g.lotNo.toUpperCase())
  r.quality = r.quality || g.quality?.name || ''
  r.inward += g.than
  r.inwardRows.push(g)
  if (!r.firstInward || g.date < r.firstInward) r.firstInward = g.date
}
for (const o of outwardRows) {
  const r = ensure(o.lot.toUpperCase())
  r.quality = r.quality || o.quality
  r.outward += o.than
  r.outwardRows.push(o)
  if (!r.lastOut || o.date > r.lastOut) r.lastOut = o.date
}
const perLot = Array.from(lotMap.values())
  .map(r => ({ ...r, balance: r.inward - r.outward }))
  .sort((a, b) => (a.firstInward?.getTime() || 0) - (b.firstInward?.getTime() || 0))

// ── Header drawer (shared) ─────────────────────────────────────────
function drawHeader(doc, subtitle) {
  doc.setFillColor(30, 41, 59)
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, 'F')
  doc.setFillColor(233, 69, 96)
  doc.rect(0, 22, doc.internal.pageSize.getWidth(), 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold').setFontSize(13)
  doc.text('KSI — Party Goods Statement', 10, 10)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text(cleanName, 10, 16)
  doc.setFontSize(8).setTextColor(200, 200, 200)
  doc.text(subtitle, doc.internal.pageSize.getWidth() - 10, 10, { align: 'right' })
  doc.text(`Generated: ${fmt(new Date())}`, doc.internal.pageSize.getWidth() - 10, 16, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

function drawSummaryBlock(doc, y) {
  const w = doc.internal.pageSize.getWidth() - 20
  const colW = w / 3
  doc.setDrawColor(220, 220, 220).setLineWidth(0.3)
  doc.roundedRect(10, y, w, 16, 2, 2)
  const labels = [
    { k: 'Total Inward (than)',  v: inwardThan,  col: [30, 100, 220] },
    { k: 'Total Outward (than)', v: outwardThan, col: [220, 90, 40] },
    { k: 'Balance with KSI',     v: balanceThan, col: balanceThan > 0 ? [22, 163, 74] : [120, 120, 120] },
  ]
  labels.forEach((l, i) => {
    const x = 10 + colW * i
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(110, 110, 110)
    doc.text(l.k, x + colW / 2, y + 5, { align: 'center' })
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...l.col)
    doc.text(String(l.v), x + colW / 2, y + 13, { align: 'center' })
  })
  doc.setTextColor(0, 0, 0)
  return y + 20
}

// ─────────────────────────────────────────────────────────────────────
// VARIANT A — Summary (totals + per-lot table). Compact 1-pager.
// ─────────────────────────────────────────────────────────────────────
{
  const doc = new jsPDF()
  drawHeader(doc, 'Variant A · Summary')
  let y = drawSummaryBlock(doc, 28)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 41, 59)
  doc.text(`Lot-wise summary (${perLot.length} lots)`, 10, y)
  y += 2
  autoTable(doc, {
    startY: y + 2,
    head: [['Lot No', 'Quality', 'First In', 'Last Out', 'Inward', 'Outward', 'Balance', 'Status']],
    body: perLot.map(r => [
      r.lotNo, r.quality, fmt(r.firstInward), fmt(r.lastOut),
      String(r.inward), String(r.outward), String(r.balance),
      r.balance === 0 ? 'Cleared' : r.outward === 0 ? 'Not despatched' : 'Partial',
    ]),
    foot: [['', '', '', 'TOTAL', String(inwardThan), String(outwardThan), String(balanceThan), '']],
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, halign: 'center' },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold', fontSize: 8 },
    bodyStyles:  { fontSize: 8 },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [67, 56, 202] },
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' },
      7: { halign: 'center', fontSize: 7 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7) {
        if (data.cell.raw === 'Cleared')         data.cell.styles.textColor = [22, 163, 74]
        else if (data.cell.raw === 'Partial')     data.cell.styles.textColor = [202, 138, 4]
        else if (data.cell.raw === 'Not despatched') data.cell.styles.textColor = [37, 99, 235]
      }
    },
    margin: { left: 10, right: 10 },
  })
  fs.writeFileSync(path.join(OUT_DIR, 'shantinath-A-summary.pdf'), Buffer.from(doc.output('arraybuffer')))
}

// ─────────────────────────────────────────────────────────────────────
// VARIANT B — Ledger style. Chronological transactions, running balance.
// ─────────────────────────────────────────────────────────────────────
{
  const doc = new jsPDF()
  drawHeader(doc, 'Variant B · Ledger style')
  let y = drawSummaryBlock(doc, 28)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 41, 59)
  doc.text('Transactions (date order)', 10, y)
  y += 2

  // Merge + sort. Inward = positive, outward = negative. Running balance.
  const txns = [
    ...grey.map(g => ({
      date: g.date, kind: 'IN', ref: `Ch ${g.challanNo}`, lot: g.lotNo, quality: g.quality?.name || '',
      detail: `Bale ${g.baleNo || '—'} · LR ${g.transportLrNo || '—'}`, than: g.than,
    })),
    ...outwardRows.map(o => ({
      date: o.date, kind: 'OUT', ref: `Ch ${o.ch}`, lot: o.lot, quality: o.quality || '',
      detail: `Bill ${o.bill || '—'}`, than: -o.than,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.kind === 'IN' ? -1 : 1))
  let bal = 0
  const body = txns.map(t => {
    bal += t.than
    return [
      fmt(t.date), t.kind, t.ref, t.lot, t.quality, t.detail,
      t.kind === 'IN' ? String(t.than) : '',
      t.kind === 'OUT' ? String(Math.abs(t.than)) : '',
      String(bal),
    ]
  })
  autoTable(doc, {
    startY: y + 2,
    head: [['Date', 'Type', 'Ref', 'Lot', 'Quality', 'Detail', 'In', 'Out', 'Bal']],
    body,
    foot: [['', '', '', '', '', 'TOTAL', String(inwardThan), String(outwardThan), String(balanceThan)]],
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, halign: 'center' },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold', fontSize: 8 },
    bodyStyles:  { fontSize: 7.5 },
    columnStyles: {
      1: { halign: 'center', fontStyle: 'bold' },
      3: { fontStyle: 'bold', textColor: [67, 56, 202] },
      6: { halign: 'right', textColor: [22, 100, 200] },
      7: { halign: 'right', textColor: [220, 90, 40] },
      8: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        if (data.cell.raw === 'IN')  data.cell.styles.textColor = [22, 100, 200]
        if (data.cell.raw === 'OUT') data.cell.styles.textColor = [220, 90, 40]
      }
    },
    margin: { left: 10, right: 10 },
  })
  fs.writeFileSync(path.join(OUT_DIR, 'shantinath-B-ledger.pdf'), Buffer.from(doc.output('arraybuffer')))
}

// ─────────────────────────────────────────────────────────────────────
// VARIANT C — Lot-wise detail. Each lot = its own section with inward
// bale list + every outward despatch. Best for "where did each lot go".
// ─────────────────────────────────────────────────────────────────────
{
  const doc = new jsPDF()
  drawHeader(doc, 'Variant C · Lot-wise detail')
  let y = drawSummaryBlock(doc, 28)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 41, 59)
  doc.text(`Per-lot breakdown (${perLot.length} lots)`, 10, y)
  y += 4
  for (const r of perLot) {
    // Header band per lot
    const pageBottom = doc.internal.pageSize.getHeight() - 12
    if (y + 30 > pageBottom) { doc.addPage(); drawHeader(doc, 'Variant C · Lot-wise detail'); y = 28 }
    doc.setFillColor(243, 244, 246)
    doc.rect(10, y, doc.internal.pageSize.getWidth() - 20, 8, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(67, 56, 202)
    doc.text(r.lotNo, 12, y + 5.5)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(80, 80, 80)
    doc.text(r.quality || '—', 60, y + 5.5)
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(30, 41, 59)
    doc.text(`In ${r.inward} · Out ${r.outward} · Bal ${r.balance}`, doc.internal.pageSize.getWidth() - 12, y + 5.5, { align: 'right' })
    y += 9

    autoTable(doc, {
      startY: y,
      head: [['', 'Date', 'Ch / Bill', 'Detail', 'Than']],
      body: [
        ...r.inwardRows.map(g => ['IN',  fmt(g.date), `Ch ${g.challanNo}`, `Bale ${g.baleNo || '—'} · LR ${g.transportLrNo || '—'}`, String(g.than)]),
        ...r.outwardRows.map(o => ['OUT', fmt(o.date), `Ch ${o.ch}${o.bill ? ' / Bill ' + o.bill : ''}`, '', String(o.than)]),
      ],
      headStyles: { fillColor: [243, 244, 246], textColor: 30, fontSize: 7.5, halign: 'left' },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { fontStyle: 'bold', halign: 'center', cellWidth: 12 },
        4: { halign: 'right', fontStyle: 'bold', cellWidth: 18 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0) {
          if (data.cell.raw === 'IN')  data.cell.styles.textColor = [22, 100, 200]
          if (data.cell.raw === 'OUT') data.cell.styles.textColor = [220, 90, 40]
        }
      },
      margin: { left: 10, right: 10 },
      theme: 'plain',
    })
    y = doc.lastAutoTable.finalY + 4
  }
  fs.writeFileSync(path.join(OUT_DIR, 'shantinath-C-lotwise.pdf'), Buffer.from(doc.output('arraybuffer')))
}

console.log(`\nWrote:`)
console.log(`  ${path.join(OUT_DIR, 'shantinath-A-summary.pdf')}`)
console.log(`  ${path.join(OUT_DIR, 'shantinath-B-ledger.pdf')}`)
console.log(`  ${path.join(OUT_DIR, 'shantinath-C-lotwise.pdf')}`)

await db.$disconnect()
