// Client-side PDF generation for the three party-stock report variants.
// jsPDF + jspdf-autotable both ship as browser-native, so we can call them
// straight from a React handler — no server round-trip beyond the data fetch.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export type ReportPayload = {
  party: { id: number; name: string; tag: string | null; lotPrefixes: string[] }
  summary: { inwardThan: number; outwardThan: number; balance: number; lotCount: number; openLotCount: number }
  perLot: Array<{
    lotNo: string; quality: string; inward: number; outward: number; balance: number
    firstInward: string | null; lastOutward: string | null
    inwardRows: Array<{ date: string; challanNo: number; baleNo: string; transportLrNo: string; than: number }>
    outwardRows: Array<{ date: string; challanNo: number; billNo: string | null; than: number }>
  }>
  inwardRows: Array<{ date: string; challanNo: number; lotNo: string; quality: string; than: number; baleNo: string; transportLrNo: string }>
  outwardRows: Array<{ date: string; challanNo: number; lotNo: string; quality: string; than: number; billNo: string | null }>
}

export type Variant = 'A' | 'B' | 'C'

const fmt = (d: string | null | undefined) => {
  if (!d) return '—'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
}

function drawHeader(doc: jsPDF, partyName: string, subtitle: string) {
  doc.setFillColor(30, 41, 59)
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, 'F')
  doc.setFillColor(233, 69, 96)
  doc.rect(0, 22, doc.internal.pageSize.getWidth(), 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold').setFontSize(13)
  doc.text('KSI — Party Stock Report', 10, 10)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text(partyName, 10, 16)
  doc.setFontSize(8).setTextColor(200, 200, 200)
  doc.text(subtitle, doc.internal.pageSize.getWidth() - 10, 10, { align: 'right' })
  doc.text(`Generated: ${fmt(new Date().toISOString())}`, doc.internal.pageSize.getWidth() - 10, 16, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

function drawSummaryBlock(doc: jsPDF, y: number, summary: ReportPayload['summary']) {
  const w = doc.internal.pageSize.getWidth() - 20
  const colW = w / 3
  doc.setDrawColor(220, 220, 220).setLineWidth(0.3)
  doc.roundedRect(10, y, w, 16, 2, 2)
  const cards: Array<{ k: string; v: number; col: [number, number, number] }> = [
    { k: 'Total Inward (than)',  v: summary.inwardThan,  col: [30, 100, 220] },
    { k: 'Total Outward (than)', v: summary.outwardThan, col: [220, 90, 40] },
    { k: 'Balance with KSI',     v: summary.balance,     col: summary.balance > 0 ? [22, 163, 74] : [120, 120, 120] },
  ]
  cards.forEach((l, i) => {
    const x = 10 + colW * i
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(110, 110, 110)
    doc.text(l.k, x + colW / 2, y + 5, { align: 'center' })
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...l.col)
    doc.text(String(l.v), x + colW / 2, y + 13, { align: 'center' })
  })
  doc.setTextColor(0, 0, 0)
  return y + 20
}

// VARIANT A — Summary (totals + per-lot table). Compact 1-pager.
function renderSummary(doc: jsPDF, d: ReportPayload) {
  drawHeader(doc, d.party.name, 'Stock Report Summary')
  let y = drawSummaryBlock(doc, 28, d.summary)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 41, 59)
  doc.text(`Lot-wise summary (${d.perLot.length} lots)`, 10, y)
  autoTable(doc, {
    startY: y + 2,
    head: [['Lot No', 'Quality', 'First In', 'Last Out', 'Inward', 'Outward', 'Balance', 'Status']],
    body: d.perLot.map(r => [
      r.lotNo, r.quality, fmt(r.firstInward), fmt(r.lastOutward),
      String(r.inward), String(r.outward), String(r.balance),
      r.balance === 0 ? 'Cleared' : r.outward === 0 ? 'Not despatched' : 'Partial',
    ]),
    foot: [['', '', '', 'TOTAL', String(d.summary.inwardThan), String(d.summary.outwardThan), String(d.summary.balance), '']],
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
}

// VARIANT B — Ledger. Chronological transactions with running balance.
function renderLedger(doc: jsPDF, d: ReportPayload) {
  drawHeader(doc, d.party.name, 'Stock Report Ledger')
  let y = drawSummaryBlock(doc, 28, d.summary)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 41, 59)
  doc.text('Transactions (date order)', 10, y)
  const txns: Array<{ date: string; kind: 'IN' | 'OUT'; ref: string; lot: string; quality: string; detail: string; signed: number }> = [
    ...d.inwardRows.map(r => ({
      date: r.date, kind: 'IN' as const, ref: `Ch ${r.challanNo}`, lot: r.lotNo, quality: r.quality,
      detail: `Bale ${r.baleNo || '—'} · LR ${r.transportLrNo || '—'}`, signed: r.than,
    })),
    ...d.outwardRows.map(r => ({
      date: r.date, kind: 'OUT' as const, ref: `Ch ${r.challanNo}`, lot: r.lotNo, quality: r.quality,
      detail: `Bill ${r.billNo || '—'}`, signed: -r.than,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || (a.kind === 'IN' ? -1 : 1))
  let bal = 0
  const body = txns.map(t => {
    bal += t.signed
    return [
      fmt(t.date), t.kind, t.ref, t.lot, t.quality, t.detail,
      t.kind === 'IN' ? String(t.signed) : '',
      t.kind === 'OUT' ? String(Math.abs(t.signed)) : '',
      String(bal),
    ]
  })
  autoTable(doc, {
    startY: y + 2,
    head: [['Date', 'Type', 'Ref', 'Lot', 'Quality', 'Detail', 'In', 'Out', 'Bal']],
    body,
    foot: [['', '', '', '', '', 'TOTAL', String(d.summary.inwardThan), String(d.summary.outwardThan), String(d.summary.balance)]],
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
}

// VARIANT C — Lot-wise detail. Each lot = its own section.
function renderLotwise(doc: jsPDF, d: ReportPayload) {
  drawHeader(doc, d.party.name, 'Stock Report Lot-wise')
  let y = drawSummaryBlock(doc, 28, d.summary)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 41, 59)
  doc.text(`Per-lot breakdown (${d.perLot.length} lots)`, 10, y)
  y += 4
  for (const r of d.perLot) {
    const pageBottom = doc.internal.pageSize.getHeight() - 12
    if (y + 30 > pageBottom) { doc.addPage(); drawHeader(doc, d.party.name, 'Stock Report Lot-wise'); y = 28 }
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
        ...r.outwardRows.map(o => ['OUT', fmt(o.date), `Ch ${o.challanNo}${o.billNo ? ' / Bill ' + o.billNo : ''}`, '', String(o.than)]),
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
    y = (doc as any).lastAutoTable.finalY + 4
  }
}

export function makePartyStockPdf(variant: Variant, data: ReportPayload): jsPDF {
  const doc = new jsPDF()
  if (variant === 'A') renderSummary(doc, data)
  else if (variant === 'B') renderLedger(doc, data)
  else renderLotwise(doc, data)
  return doc
}

export function fileNameFor(variant: Variant, partyName: string, ext: 'pdf' | 'xlsx') {
  const slug = partyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const tag = variant === 'A' ? 'summary' : variant === 'B' ? 'ledger' : 'lotwise'
  return `stock-report-${tag}-${slug}.${ext}`
}

export function variantTitle(variant: Variant) {
  return variant === 'A' ? 'Stock Report Summary'
    : variant === 'B' ? 'Stock Report Ledger'
    : 'Stock Report Lot-wise'
}
