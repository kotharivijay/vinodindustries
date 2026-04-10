// PDF generation + share utility for dyeing slips
// Generates A4 PDF in light mode regardless of app theme

import jsPDF from 'jspdf'

export interface SlipData {
  slipNo: number | string
  date: string | Date
  shadeName?: string | null
  shadeDescription?: string | null
  lots: { lotNo: string; than: number }[]
  chemicals: { name: string; quantity: number | null; unit: string; rate: number | null; cost: number | null }[]
  mandi?: number | null
  notes?: string | null
  status?: string | null
  dyeingDoneAt?: string | Date | null
  machine?: string | null
  operator?: string | null
  totalRounds?: number | null
}

const COMPANY_NAME = 'KOTHARI SYNTHETIC INDUSTRIES'
const COMPANY_SUBTITLE = 'Dyeing Slip'

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-IN')
}

/**
 * Render one slip onto a jsPDF page.
 * @param doc - jsPDF instance
 * @param slip - slip data
 * @param isFirstPage - whether to skip addPage()
 */
function renderSlipPage(doc: jsPDF, slip: SlipData, isFirstPage: boolean) {
  if (!isFirstPage) doc.addPage()

  const pageW = doc.internal.pageSize.getWidth()
  let y = 15

  // ── HEADER ──
  doc.setFillColor(99, 102, 241) // indigo-500
  doc.rect(0, 0, pageW, 18, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(COMPANY_NAME, pageW / 2, 8, { align: 'center' })
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(COMPANY_SUBTITLE, pageW / 2, 14, { align: 'center' })

  // ── BODY START ──
  y = 26
  doc.setTextColor(15, 23, 42) // dark text
  doc.setFontSize(11)

  // Slip No + Date row
  doc.setFont('helvetica', 'bold')
  doc.text('Slip No:', 15, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.setTextColor(99, 102, 241)
  doc.text(`#${slip.slipNo}`, 35, y)

  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.text('Date:', pageW - 60, y)
  doc.setFont('helvetica', 'normal')
  doc.text(fmtDate(slip.date), pageW - 45, y)

  y += 8

  // Shade row
  if (slip.shadeName || slip.shadeDescription) {
    doc.setFont('helvetica', 'bold')
    doc.text('Shade:', 15, y)
    doc.setFont('helvetica', 'normal')
    const shadeText = [slip.shadeName, slip.shadeDescription].filter(Boolean).join(' — ')
    doc.text(shadeText, 35, y)
    y += 7
  }

  // Status row
  if (slip.status || slip.dyeingDoneAt) {
    doc.setFont('helvetica', 'bold')
    doc.text('Status:', 15, y)
    doc.setFont('helvetica', 'normal')
    const statusText = slip.status === 'done' || slip.dyeingDoneAt
      ? `✓ Done${slip.dyeingDoneAt ? ' • ' + fmtDate(slip.dyeingDoneAt) : ''}`
      : (slip.status || 'pending')
    if (slip.status === 'done' || slip.dyeingDoneAt) doc.setTextColor(34, 197, 94)
    doc.text(statusText, 35, y)
    doc.setTextColor(15, 23, 42)
    y += 7
  }

  // Machine + Operator
  if (slip.machine || slip.operator) {
    doc.setFont('helvetica', 'bold')
    if (slip.machine) {
      doc.text('Machine:', 15, y)
      doc.setFont('helvetica', 'normal')
      doc.text(slip.machine, 38, y)
    }
    if (slip.operator) {
      doc.setFont('helvetica', 'bold')
      doc.text('Operator:', pageW / 2, y)
      doc.setFont('helvetica', 'normal')
      doc.text(slip.operator, pageW / 2 + 23, y)
    }
    y += 7
  }

  y += 3
  doc.setDrawColor(226, 232, 240)
  doc.line(15, y, pageW - 15, y)
  y += 6

  // ── LOTS SECTION ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(99, 102, 241)
  doc.text('LOTS', 15, y)
  y += 6

  doc.setTextColor(15, 23, 42)
  doc.setFontSize(10)
  let totalThan = 0
  for (const lot of slip.lots) {
    doc.setFont('helvetica', 'normal')
    doc.text(`▪ ${lot.lotNo}`, 20, y)
    doc.setFont('helvetica', 'bold')
    doc.text(`${fmtNum(lot.than)} than`, pageW - 20, y, { align: 'right' })
    totalThan += lot.than
    y += 6
  }

  // Total than
  doc.setDrawColor(226, 232, 240)
  doc.line(pageW - 60, y, pageW - 15, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.text('Total', pageW - 60, y)
  doc.text(`${fmtNum(totalThan)} than`, pageW - 15, y, { align: 'right' })

  y += 8
  doc.setDrawColor(226, 232, 240)
  doc.line(15, y, pageW - 15, y)
  y += 6

  // ── CHEMICALS SECTION ──
  if (slip.chemicals && slip.chemicals.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(99, 102, 241)
    doc.text('CHEMICALS', 15, y)
    y += 6

    doc.setTextColor(15, 23, 42)
    doc.setFontSize(9)

    let totalCost = 0
    for (const c of slip.chemicals) {
      doc.setFont('helvetica', 'normal')
      doc.text(`▪ ${c.name}`, 20, y)
      const qtyStr = c.quantity ? `${c.quantity} ${c.unit}` : ''
      doc.text(qtyStr, pageW / 2 + 5, y)
      const costStr = c.cost ? `₹${fmtNum(Math.round(c.cost))}` : ''
      doc.setFont('helvetica', 'bold')
      doc.text(costStr, pageW - 20, y, { align: 'right' })
      totalCost += c.cost || 0
      y += 5
    }

    if (totalCost > 0) {
      y += 1
      doc.setDrawColor(226, 232, 240)
      doc.line(pageW - 60, y, pageW - 15, y)
      y += 5
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text('Total Cost', pageW - 60, y)
      doc.text(`₹${fmtNum(Math.round(totalCost))}`, pageW - 15, y, { align: 'right' })
      y += 5
      if (totalThan > 0) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(100, 116, 139)
        doc.text(`Cost / than`, pageW - 60, y)
        doc.text(`₹${(totalCost / totalThan).toFixed(2)}`, pageW - 15, y, { align: 'right' })
        doc.setTextColor(15, 23, 42)
      }
    }

    y += 8
    doc.setDrawColor(226, 232, 240)
    doc.line(15, y, pageW - 15, y)
    y += 6
  }

  // ── BOTTOM INFO ──
  doc.setFontSize(10)
  if (slip.mandi) {
    doc.setFont('helvetica', 'bold')
    doc.text('Mandi:', 15, y)
    doc.setFont('helvetica', 'normal')
    doc.text(`${slip.mandi} L`, 33, y)
    y += 6
  }

  if (slip.totalRounds) {
    doc.setFont('helvetica', 'bold')
    doc.text('Rounds:', 15, y)
    doc.setFont('helvetica', 'normal')
    doc.text(String(slip.totalRounds), 35, y)
    y += 6
  }

  if (slip.notes) {
    doc.setFont('helvetica', 'bold')
    doc.text('Notes:', 15, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const noteLines = doc.splitTextToSize(slip.notes, pageW - 30)
    doc.text(noteLines, 15, y)
  }

  // Footer
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.setFont('helvetica', 'normal')
  doc.text(`Generated on ${fmtDate(new Date())}`, pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' })
}

/**
 * Generate PDF for a single dyeing slip.
 * Returns a Blob that can be shared or downloaded.
 */
export function generateSlipPDF(slip: SlipData): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  renderSlipPage(doc, slip, true)
  return doc.output('blob')
}

/**
 * Generate one PDF containing multiple slips (one per page).
 */
export function generateMultiSlipPDF(slips: SlipData[]): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  slips.forEach((slip, i) => renderSlipPage(doc, slip, i === 0))
  return doc.output('blob')
}

/**
 * Share a PDF blob via Web Share API (mobile WhatsApp).
 * Falls back to download on desktop.
 */
export async function sharePDF(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'application/pdf' })

  // Try Web Share API first (mobile → WhatsApp)
  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (err: any) {
      // User cancelled — that's OK
      if (err?.name === 'AbortError') return
    }
  }

  // Fallback: download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
