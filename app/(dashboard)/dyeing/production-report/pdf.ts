// Client-side PDF for the Dyeing Production Report (entries + breakdowns).
// jsPDF + jspdf-autotable are browser-native, so this runs straight from a
// React handler. Mirrors app/(dashboard)/reports/party-stock/pdf.ts.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export type ProductionEntry = {
  id: number
  date: string
  slipNo: number
  than: number
  totalCost: number
  machine: string | null
  operator: string | null
  party: string | null
  quality: string | null
  status: string
  isPaliPc?: boolean
  lots: Array<{ lotNo: string; than: number }>
}

export type ProductionPayload = {
  summary: { totalBatches: number; totalThan: number; totalCost: number; doneCount: number; patchyCount: number; reDyeCount: number }
  byMachine: Array<{ name: string; batches: number; than: number; cost: number }>
  byOperator: Array<{ name: string; batches: number; than: number; cost: number }>
  entries: ProductionEntry[]
}

const fmtD = (d: string) => {
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`
}
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

function header(doc: jsPDF, title: string, subtitle: string) {
  const w = doc.internal.pageSize.getWidth()
  doc.setFillColor(30, 41, 59); doc.rect(0, 0, w, 22, 'F')
  doc.setFillColor(124, 58, 237); doc.rect(0, 22, w, 1.5, 'F')
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(13)
  doc.text(title, 10, 10)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text(subtitle, 10, 16)
  doc.setFontSize(8).setTextColor(200, 200, 200)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, w - 10, 16, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

export function makeProductionPdf(d: ProductionPayload, rangeLabel: string, nonPcPali: boolean): jsPDF {
  const doc = new jsPDF()
  const title = nonPcPali ? 'KSI — Production (Non PC Pali Job)' : 'KSI — Dyeing Production Report'
  header(doc, title, rangeLabel)

  // Summary line
  let y = 30
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(30, 41, 59)
  doc.text(
    `Batches ${d.summary.totalBatches}   Than ${d.summary.totalThan}   Cost ${inr(d.summary.totalCost)}   Done ${d.summary.doneCount}   Patchy ${d.summary.patchyCount}   Re-Dyed ${d.summary.reDyeCount}`,
    10, y,
  )
  y += 4

  // Entries table
  autoTable(doc, {
    startY: y,
    head: [['Date', 'Slip', 'Lot No', 'Than', 'Jet', 'Operator', 'Party']],
    body: d.entries.map(e => [
      fmtD(e.date), String(e.slipNo),
      e.lots.map(l => l.lotNo).join(', '),
      String(e.than), e.machine || '-', e.operator || '-', e.party || '-',
    ]),
    foot: [['', '', 'TOTAL', String(d.summary.totalThan), '', '', '']],
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, halign: 'center' },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    columnStyles: {
      1: { fontStyle: 'bold', textColor: [124, 58, 237], halign: 'center' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 10, right: 10 },
  })
  y = (doc as any).lastAutoTable.finalY + 6

  // Party breakdown (derived from entries)
  const byParty = new Map<string, { slips: number; than: number }>()
  for (const e of d.entries) {
    const p = e.party || '(unknown)'
    const c = byParty.get(p) || { slips: 0, than: 0 }
    c.slips++; c.than += e.than; byParty.set(p, c)
  }
  const pageBottom = doc.internal.pageSize.getHeight() - 12
  if (y + 20 > pageBottom) { doc.addPage(); y = 14 }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 41, 59)
  doc.text('By Party', 10, y); y += 2
  autoTable(doc, {
    startY: y,
    head: [['Party', 'Slips', 'Than']],
    body: [...byParty.entries()].sort((a, b) => b[1].than - a[1].than).map(([p, v]) => [p, String(v.slips), String(v.than)]),
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 10, right: 10 },
  })

  return doc
}

export function productionFileName(rangeLabel: string, nonPcPali: boolean, ext: 'pdf' | 'xlsx') {
  const slug = rangeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${nonPcPali ? 'non-pc-pali' : 'production'}-${slug || 'report'}.${ext}`
}
