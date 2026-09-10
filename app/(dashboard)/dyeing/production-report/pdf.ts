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

// ── Batch Production (Batch Maker slips) ────────────────────────────────────

export type BatchProductionPayload = {
  summary: { slips: number; batches: number; than: number; weight: number; notDyedBatches: number; notDyedThan: number; inDyeingBatches: number; inDyeingThan: number }
  byDate: Array<{ date: string; slips: number; batches: number; than: number; notDyedThan: number; inDyeingThan: number }>
  byMaker: Array<{ name: string; slips: number; batches: number; than: number; notDyedThan: number; inDyeingThan: number }>
  byJet: Array<{ name: string; batches: number; than: number }>
  slips: Array<{
    slipNo: string; date: string; maker: string; batches: number; than: number; weight: number; notDyed: number; inDyeing: number
    items: Array<{ foldNo: string; batchNo: number; shade: string | null; marka: string | null; than: number; weight: number; jet: string | null; party: string | null; dyeStatus: 'not-dyed' | 'in-dyeing' | 'dyed'; dyeSlipNo: number | null }>
  }>
}

const dyeLabel = (s: 'not-dyed' | 'in-dyeing' | 'dyed', n: number | null) =>
  s === 'not-dyed' ? 'NOT DYED' : s === 'in-dyeing' ? `In dyeing${n ? ' (dye ' + n + ')' : ''}` : `Dyed${n ? ' (dye ' + n + ')' : ''}`

export function makeBatchProductionPdf(d: BatchProductionPayload, rangeLabel: string): jsPDF {
  const doc = new jsPDF()
  header(doc, 'KSI — Batch Production (Batch Maker slips)', rangeLabel)
  const pageBottom = doc.internal.pageSize.getHeight() - 12
  const ensure = (y: number, need: number) => { if (y + need > pageBottom) { doc.addPage(); return 14 } return y }
  const section = (y: number, title: string) => {
    y = ensure(y, 20)
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 41, 59)
    doc.text(title, 10, y)
    return y + 2
  }
  const groupCols = { 1: { halign: 'right' as const }, 2: { halign: 'right' as const }, 3: { halign: 'right' as const, fontStyle: 'bold' as const }, 4: { halign: 'right' as const, textColor: [180, 83, 9] as [number, number, number] }, 5: { halign: 'right' as const, textColor: [29, 78, 216] as [number, number, number] } }

  let y = 30
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(30, 41, 59)
  doc.text(
    `BM Slips ${d.summary.slips}   Batches ${d.summary.batches}   Than ${d.summary.than}   Weight ${d.summary.weight.toLocaleString('en-IN')} kg   ` +
    `Not dyed ${d.summary.notDyedBatches} (${d.summary.notDyedThan} than)   In dyeing ${d.summary.inDyeingBatches} (${d.summary.inDyeingThan} than)`,
    10, y,
  )
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(120, 120, 120)
  doc.text('Cancelled slips and cancelled fold batches are excluded.', 10, y + 4)
  y += 8

  y = section(y, 'Daily')
  autoTable(doc, {
    startY: y,
    head: [['Date', 'Slips', 'Batches', 'Than', 'Not dyed', 'In dyeing']],
    body: d.byDate.map(g => [fmtD(g.date), String(g.slips), String(g.batches), String(g.than), g.notDyedThan ? String(g.notDyedThan) : '', g.inDyeingThan ? String(g.inDyeingThan) : '']),
    foot: [['TOTAL', String(d.summary.slips), String(d.summary.batches), String(d.summary.than), String(d.summary.notDyedThan), String(d.summary.inDyeingThan)]],
    showFoot: 'lastPage',
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, halign: 'center' },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold', fontSize: 8, halign: 'right' },
    bodyStyles: { fontSize: 7.5 }, columnStyles: groupCols, margin: { left: 10, right: 10 },
  })
  y = (doc as any).lastAutoTable.finalY + 6

  y = section(y, 'By Batch Maker')
  autoTable(doc, {
    startY: y,
    head: [['Batch Maker', 'Slips', 'Batches', 'Than', 'Not dyed', 'In dyeing']],
    body: d.byMaker.map(g => [g.name, String(g.slips), String(g.batches), String(g.than), g.notDyedThan ? String(g.notDyedThan) : '', g.inDyeingThan ? String(g.inDyeingThan) : '']),
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7.5 }, columnStyles: groupCols, margin: { left: 10, right: 10 },
  })
  y = (doc as any).lastAutoTable.finalY + 6

  y = section(y, 'By Jet')
  autoTable(doc, {
    startY: y,
    head: [['Jet', 'Batches', 'Than']],
    body: d.byJet.map(g => [g.name, String(g.batches), String(g.than)]),
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7.5 }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 10, right: 10 }, tableWidth: 90,
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // Slip-wise detail, one row per batch, dye status in the last column.
  y = section(ensure(y, 40), 'Slips — batch detail')
  const body: any[][] = []
  for (const s of d.slips) {
    body.push([{ content: `${s.slipNo}   ${s.maker}   ${fmtD(s.date)}   ${s.batches} batches · ${s.than} than · ${Math.round(s.weight)} kg${s.notDyed ? `   |   ${s.notDyed} NOT DYED` : ''}`, colSpan: 8, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [30, 41, 59] } }])
    for (const i of s.items) {
      body.push([`Fold ${i.foldNo}-B${i.batchNo}`, i.shade || '-', i.marka || '-', i.jet || '-', i.party || '-', String(i.than), i.weight ? String(Math.round(i.weight * 10) / 10) : '-', dyeLabel(i.dyeStatus, i.dyeSlipNo)])
    }
  }
  autoTable(doc, {
    startY: y,
    head: [['Batch', 'Shade', 'Marka', 'Jet', 'Party', 'Than', 'Kg', 'Dyeing']],
    body,
    foot: [['TOTAL', '', '', '', `${d.summary.slips} slips · ${d.summary.batches} batches`, String(d.summary.than), String(Math.round(d.summary.weight)), `${d.summary.notDyedBatches} not dyed`]],
    showFoot: 'lastPage',
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, halign: 'center' },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 7, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 26 }, 1: { cellWidth: 22 }, 2: { cellWidth: 20 }, 3: { cellWidth: 14, halign: 'center' }, 5: { halign: 'right', fontStyle: 'bold', cellWidth: 12 }, 6: { halign: 'right', cellWidth: 12 }, 7: { cellWidth: 30 } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7 && typeof data.cell.raw === 'string') {
        if (data.cell.raw === 'NOT DYED') { data.cell.styles.textColor = [180, 83, 9]; data.cell.styles.fontStyle = 'bold' }
        else if (data.cell.raw.startsWith('In dyeing')) data.cell.styles.textColor = [29, 78, 216]
        else if (data.cell.raw.startsWith('Dyed')) data.cell.styles.textColor = [21, 128, 61]
      }
    },
    margin: { left: 10, right: 10 },
  })

  return doc
}

export function productionFileName(rangeLabel: string, nonPcPali: boolean, ext: 'pdf' | 'xlsx') {
  const slug = rangeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${nonPcPali ? 'non-pc-pali' : 'production'}-${slug || 'report'}.${ext}`
}
