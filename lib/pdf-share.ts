// PDF generation + share utility for dyeing slips
// Matches the existing print page layout (print/page.tsx)

import jsPDF from 'jspdf'

export interface SlipChemical {
  name: string
  quantity: number | null
  unit: string
  rate: number | null
  cost: number | null
  processTag?: string | null
}

export interface SlipData {
  slipNo: number | string
  date: string | Date
  partyName?: string | null
  shadeName?: string | null
  shadeDescription?: string | null
  qualityName?: string | null
  marka?: string | null
  isPcJob?: boolean
  lots: { lotNo: string; than: number; marka?: string | null }[]
  chemicals: SlipChemical[]
  mandi?: number | null
  notes?: string | null
  status?: string | null
  dyeingDoneAt?: string | Date | null
  machine?: string | null
  operator?: string | null
  totalRounds?: number | null
  isReDyed?: boolean
}

const COMPANY_NAME = 'KOTHARI SYNTHETIC INDUSTRIES'

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Render one slip onto a jsPDF page — matching the print page layout.
 */
function renderSlipPage(doc: jsPDF, slip: SlipData, isFirstPage: boolean) {
  if (!isFirstPage) doc.addPage()

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const ml = 15 // margin left
  const mr = pageW - 15 // margin right
  let y = 12

  // ── HEADER (centered, border-bottom like print page) ──
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(COMPANY_NAME, pageW / 2, y, { align: 'center' })
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const subtitle = slip.isPcJob ? 'PC Dyeing Slip' : 'Dyeing Slip'
  doc.setTextColor(100, 100, 100)
  doc.text(subtitle, pageW / 2, y, { align: 'center' })
  if (slip.isReDyed && slip.totalRounds && slip.totalRounds > 1) {
    y += 4
    doc.setFontSize(8)
    doc.setTextColor(220, 38, 38)
    doc.setFont('helvetica', 'bold')
    doc.text(`RE-DYED (${slip.totalRounds} rounds)`, pageW / 2, y, { align: 'center' })
  }
  y += 4
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.5)
  doc.line(ml, y, mr, y)
  y += 6

  // ── SLIP INFO GRID (2 columns, bordered box like print page) ──
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(9)
  const infoStartY = y
  const colW = (mr - ml) / 2
  const rowH = 5.5

  const infoRows: [string, string, string, string][] = [
    ['Slip No:', String(slip.slipNo), 'Date:', fmtDate(slip.date)],
    ['Party:', slip.partyName || '\u2014', 'Shade:', [slip.shadeName, slip.shadeDescription].filter(Boolean).join(' \u2014 ') || '\u2014'],
  ]
  if (slip.qualityName || slip.marka) {
    infoRows.push(['Quality:', slip.qualityName || '\u2014', 'Marka:', slip.marka || '\u2014'])
  }
  infoRows.push(['Machine:', slip.machine || '\u2014', 'Operator:', slip.operator || '\u2014'])

  // Draw bordered box
  const boxH = infoRows.length * rowH + 4
  doc.setDrawColor(180, 180, 180)
  doc.setLineWidth(0.3)
  doc.roundedRect(ml, y - 2, mr - ml, boxH, 1, 1)

  for (const [label1, val1, label2, val2] of infoRows) {
    doc.setFont('helvetica', 'bold')
    doc.text(label1, ml + 3, y + 2)
    doc.setFont('helvetica', 'normal')
    doc.text(val1, ml + 25, y + 2)
    doc.setFont('helvetica', 'bold')
    doc.text(label2, ml + colW + 3, y + 2)
    doc.setFont('helvetica', 'normal')
    // Truncate long shade text
    const maxValW = colW - 28
    const truncVal2 = doc.getTextWidth(val2) > maxValW ? val2.substring(0, 40) + '...' : val2
    doc.text(truncVal2, ml + colW + 25, y + 2)
    y += rowH
  }
  y += 6

  // ── LOTS (inline like print page) ──
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Lots: ', ml, y)

  let lotX = ml + doc.getTextWidth('Lots: ') + 1
  const totalThan = slip.lots.reduce((s, l) => s + l.than, 0)
  for (let i = 0; i < slip.lots.length; i++) {
    const l = slip.lots[i]
    doc.setFont('helvetica', 'bold')
    const lotText = l.marka ? `${l.lotNo} [${l.marka}]` : l.lotNo
    doc.text(lotText, lotX, y)
    lotX += doc.getTextWidth(lotText)
    doc.setFont('helvetica', 'normal')
    const thanText = ` (${l.than} than)${i < slip.lots.length - 1 ? ', ' : ''}`
    doc.text(thanText, lotX, y)
    lotX += doc.getTextWidth(thanText) + 1
    // Wrap if too wide
    if (lotX > mr - 30 && i < slip.lots.length - 1) {
      y += 5
      lotX = ml + 5
    }
  }
  if (slip.lots.length > 1) {
    doc.setFont('helvetica', 'bold')
    doc.text(`  Total: ${totalThan} than`, lotX, y)
  }
  y += 8

  // ── CHEMICALS (grouped by processTag, table format like print page) ──
  if (slip.chemicals && slip.chemicals.length > 0) {
    // Group by processTag
    const grouped: Record<string, SlipChemical[]> = {}
    for (const c of slip.chemicals) {
      const tag = c.processTag || '_other'
      if (!grouped[tag]) grouped[tag] = []
      grouped[tag].push(c)
    }
    const tagOrder = Object.keys(grouped).sort((a, b) => {
      if (a === 'shade') return -1
      if (b === 'shade') return 1
      if (a === '_other') return 1
      if (b === '_other') return -1
      return a.localeCompare(b)
    })

    for (const tag of tagOrder) {
      const chems = grouped[tag]
      const isDye = tag === 'shade'
      const label = isDye ? 'Dyes (grams)' : tag === '_other' ? 'Other (kg)' : `${tag} (kg)`

      // Section header with underline
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(0, 0, 0)
      doc.text(label.toUpperCase(), ml, y)
      y += 1
      doc.setDrawColor(150, 150, 150)
      doc.setLineWidth(0.3)
      doc.line(ml, y, mr, y)
      y += 4

      // Table header
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(80, 80, 80)
      doc.text('#', ml, y)
      doc.text('Chemical', ml + 8, y)
      doc.text('Quantity', mr - 35, y, { align: 'right' })
      doc.text('Unit', mr - 20, y)
      y += 1
      doc.setDrawColor(200, 200, 200)
      doc.line(ml, y, mr, y)
      y += 4

      // Chemical rows
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(9)
      for (let i = 0; i < chems.length; i++) {
        const c = chems[i]
        let qty = '\u2014'
        let unit = c.unit
        if (c.quantity != null) {
          if (isDye) {
            qty = String(Math.round(c.quantity * 1000)).padStart(4, '0')
            unit = 'gm'
          } else {
            qty = Number(c.quantity).toFixed(1)
            unit = 'kg'
          }
        }

        doc.setFont('helvetica', 'normal')
        doc.setTextColor(120, 120, 120)
        doc.text(String(i + 1), ml, y)
        doc.setTextColor(0, 0, 0)
        doc.setFont('helvetica', 'normal')
        doc.text(c.name, ml + 8, y)
        doc.setFont('helvetica', 'bold')
        doc.text(qty, mr - 35, y, { align: 'right' })
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(100, 100, 100)
        doc.text(unit, mr - 20, y)
        y += 1
        doc.setDrawColor(230, 230, 230)
        doc.line(ml, y, mr, y)
        y += 4

        // Page overflow check
        if (y > pageH - 40) {
          doc.addPage()
          y = 15
        }
      }
      y += 4
    }
  } else {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(150, 150, 150)
    doc.text('No chemicals recorded.', ml, y)
    y += 8
  }

  // ── NOTES ──
  if (slip.notes) {
    doc.setDrawColor(200, 200, 200)
    doc.line(ml, y, mr, y)
    y += 4
    doc.setFontSize(9)
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'bold')
    doc.text('Notes: ', ml, y)
    doc.setFont('helvetica', 'normal')
    const noteLines = doc.splitTextToSize(slip.notes, mr - ml - 15)
    doc.text(noteLines, ml + 15, y)
    y += noteLines.length * 4 + 4
  }

  // ── SIGNATURE LINES (like print page) ──
  const sigY = Math.max(y + 20, pageH - 30)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)
  doc.line(ml, sigY, ml + 40, sigY)
  doc.line(mr - 40, sigY, mr, sigY)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.text('Prepared By', ml + 5, sigY + 4)
  doc.text('Approved By', mr - 35, sigY + 4)
}

/**
 * Generate PDF for a single dyeing slip.
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

  // Try Web Share API first (mobile -> WhatsApp)
  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (err: any) {
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
