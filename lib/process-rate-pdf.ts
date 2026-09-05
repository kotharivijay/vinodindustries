// A4 PDF of an approved process-rate contract, for WhatsApp/print sharing.
// Mirrors lib/delivery-challan-pdf.ts conventions (header band, autoTable
// styling, compaction, share-or-download via lib/pdf-share.ts).
//
// Carries what the PNG share cannot: the FULL linked-lots table, one row per
// grey inward — Lot No · Date · Challan · Marka · Than · LR — so the party can
// reconcile exactly which cloth the rate covers. The effective-from date is
// highlighted, same as on the image.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { notesToPoints } from '@/lib/process-rate-notes'
import { sharePDF } from '@/lib/pdf-share'
import type { ShareContract } from '@/lib/process-rate-share'

export type ShareLot = {
  lotNo: string
  date: string | Date
  challanNo: number | null
  marka: string | null
  than: number
  lrNo: string | null
}

const enIN = (n: number | string) => new Intl.NumberFormat('en-IN').format(Number(n))
const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('en-IN')
// helvetica has no ₹ glyph — same workaround as the receipts PDF.
const rs = (v: string | null) => (v == null ? '-' : 'Rs ' + Number(v).toFixed(2))

export function buildProcessRatePdf(c: ShareContract, lots: ShareLot[]): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const marginL = 12, marginR = 12

  // ── company header ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('Kothari Synthetic Industries', marginL, 16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text('Tilwara Road, Jasol  ·  GSTIN 08AABFK2105R1Z8', marginL, 21)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.setTextColor(4, 120, 87)
  doc.text('APPROVED PROCESS RATE', pageW - marginR, 16, { align: 'right' })
  doc.setTextColor(30, 30, 30)
  doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.6)
  doc.line(marginL, 25, pageW - marginR, 25)

  // ── party + highlighted effective date ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(c.partyName, marginL, 33)
  const dateLabel = 'EFFECTIVE ' + new Date(c.effectiveFrom)
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
  doc.setFontSize(10)
  const dw = doc.getTextWidth(dateLabel)
  doc.setFillColor(251, 191, 36)                       // amber highlight
  doc.rect(marginL, 36.5, dw + 6, 7, 'F')
  doc.setTextColor(30, 41, 59)
  doc.text(dateLabel, marginL + 3, 41.5)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90)
  const rightMeta = [
    `Contract: v${c.version} · ${c.status}`,
    c.validityQty != null ? `Valid till ${enIN(c.validityQty)} ${c.validityUnit}` : 'No quantity cap',
    `Linked: ${lots.length} lot${lots.length === 1 ? '' : 's'} · ${enIN(lots.reduce((s, l) => s + l.than, 0))} than`,
  ]
  rightMeta.forEach((line, i) => doc.text(line, pageW - marginR, 31 + i * 4.5, { align: 'right' }))
  doc.setTextColor(30, 30, 30)

  // ── rates table ──
  let y = 48
  autoTable(doc, {
    startY: y,
    head: [['Process', 'Mode', 'Unit', 'Rate', 'Light', 'Medium', 'Dark']],
    body: c.lines.map(l => {
      const by = l.rateMode === 'BY_COLOR_CATEGORY'
      return [
        l.processTypeName,
        by ? 'by colour' : 'flat',
        '/' + l.unit,
        by ? '-' : rs(l.rate),
        by ? rs(l.rateLight) : '-',
        by ? rs(l.rateMedium) : '-',
        by ? rs(l.rateDark) : '-',
      ]
    }),
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { fontStyle: 'bold' },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
    },
    margin: { left: marginL, right: marginR },
  })
  y = (doc as any).lastAutoTable.finalY + 5

  // ── terms & notes, point-wise ──
  const points = notesToPoints(c.notes)
  if (points.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text('TERMS & NOTES', marginL, y + 3)
    y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    for (const p of points) {
      const wrapped = doc.splitTextToSize(`${p.n}. ${p.text}`, pageW - marginL - marginR - 2)
      doc.text(wrapped, marginL + 1, y + 3)
      y += wrapped.length * 4 + 1.5
    }
    y += 2
  }

  // ── linked lots, row-wise ──
  if (lots.length) {
    const sorted = [...lots].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime() || (a.challanNo ?? 0) - (b.challanNo ?? 0) || a.lotNo.localeCompare(b.lotNo))
    const totalThan = sorted.reduce((s, l) => s + l.than, 0)
    // Same compaction idiom as the delivery-challan PDF, so a 150-lot
    // contract stays readable without ballooning the page count.
    const compact = sorted.length > 22
    const veryCompact = sorted.length > 40
    const rowFont = veryCompact ? 6.5 : compact ? 7 : 8
    const rowPad = veryCompact ? 0.6 : compact ? 0.9 : 1.4

    autoTable(doc, {
      startY: y,
      head: [['#', 'Lot No', 'Date', 'Challan', 'Marka', 'Than', 'LR No']],
      body: sorted.map((l, i) => [
        String(i + 1),
        l.lotNo,
        fmtDate(l.date),
        l.challanNo != null ? String(l.challanNo) : '-',
        l.marka || '-',
        String(l.than),
        l.lrNo || '-',
      ]),
      foot: [['', `TOTAL (${sorted.length} lots)`, '', '', '', String(totalThan), '']],
      theme: 'grid',
      styles: { fontSize: rowFont, cellPadding: rowPad, textColor: [30, 30, 30], lineColor: [200, 200, 200] },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: rowFont },
      footStyles: { fillColor: [230, 230, 230], textColor: [30, 30, 30], fontStyle: 'bold', fontSize: rowFont },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center' },
        1: { cellWidth: 42, fontStyle: 'bold' },
        2: { cellWidth: 24 },
        3: { cellWidth: 20, halign: 'center' },
        4: { cellWidth: 32 },
        5: { cellWidth: 16, halign: 'right', fontStyle: 'bold' },
        // LR takes the remainder
      },
      margin: { left: marginL, right: marginR },
    })
    y = (doc as any).lastAutoTable.finalY
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(120, 120, 120)
    doc.text('No grey-inward lots linked to this version yet.', marginL, y + 4)
    doc.setTextColor(30, 30, 30)
    y += 8
  }

  // ── footer note ──
  const h = doc.internal.pageSize.getHeight()
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 100, 100)
  doc.text('Please confirm these rates and terms.', marginL, Math.min(y + 10, h - 10))
  doc.setTextColor(30, 30, 30)

  return doc
}

export function processRatePdfFileName(c: ShareContract): string {
  return `process-rate-${c.partyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v${c.version}.pdf`
}

/** Native share sheet (pick the party's WhatsApp chat) with download fallback. */
export async function shareProcessRatePdf(c: ShareContract, lots: ShareLot[]): Promise<void> {
  const doc = buildProcessRatePdf(c, lots)
  await sharePDF(doc.output('blob'), processRatePdfFileName(c))
}
