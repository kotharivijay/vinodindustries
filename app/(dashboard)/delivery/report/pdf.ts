// Client-side PDF for the Delivery Challan Report.
// Mirrors app/(dashboard)/dyeing/production-report/pdf.ts — same header band,
// autoTable styling and foot-total convention.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export type ReportLot = { lot: string; marka: string; quality: string; dyeSlips: string; than: number }
export type ReportChallan = { no: number; party: string; date: string; lots: ReportLot[]; than: number }
export type ReportParty = { name: string; challans: ReportChallan[]; than: number; challanCount: number }

export type ChallanReportPayload = {
  summary: { totalThan: number; challans: number; lots: number }
  parties: ReportParty[]
}

const fmtD = (d: string) => {
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`
}

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

export function makeChallanReportPdf(d: ChallanReportPayload, rangeLabel: string): jsPDF {
  const doc = new jsPDF()
  header(doc, 'KSI — Delivery Challan Report', rangeLabel)

  let y = 30
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(30, 41, 59)
  doc.text(
    `Total Than ${d.summary.totalThan}   Challans ${d.summary.challans}   Lots ${d.summary.lots}`,
    10, y,
  )
  y += 4

  // One table per challan, grouped under its party — matches the on-screen
  // Party-wise tab so the printed report reads the same way.
  for (const p of d.parties) {
    for (const c of p.challans) {
      autoTable(doc, {
        startY: y,
        head: [[
          { content: `${p.name}  ·  Challan ${c.no}  ·  ${fmtD(c.date)}`, colSpan: 4, styles: { halign: 'left' as const } },
          { content: `${c.than} than`, styles: { halign: 'right' as const } },
        ]],
        body: [
          ['Lot No', 'Marka', 'Quality', 'Dye Slips', 'Than'],
          ...c.lots.map(l => [l.lot, l.marka || '-', l.quality || '-', l.dyeSlips || '-', String(l.than)]),
        ],
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 },
        bodyStyles: { fontSize: 7.5 },
        // First body row is the column-label row — tint it like a sub-head.
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.row.index === 0) {
            data.cell.styles.fillColor = [241, 245, 249]
            data.cell.styles.fontStyle = 'bold'
          }
          if (data.column.index === 4) data.cell.styles.halign = 'right'
        },
        columnStyles: {
          0: { fontStyle: 'bold', textColor: [67, 56, 202] },
          3: { textColor: [124, 58, 237] },
          4: { halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
      })
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 5
      if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 16 }
    }
  }

  // Party totals recap
  autoTable(doc, {
    startY: y,
    head: [['Party', 'Challans', 'Than']],
    body: d.parties.map(p => [p.name, String(p.challanCount), String(p.than)]),
    foot: [['TOTAL', String(d.summary.challans), String(d.summary.totalThan)]],
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 },
    footStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 10, right: 10 },
  })

  return doc
}

export function challanReportFileName(rangeLabel: string, ext: 'pdf' | 'xlsx'): string {
  const slug = rangeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `delivery-challan-report-${slug || 'range'}.${ext}`
}
