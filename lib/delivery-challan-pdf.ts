import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface DeliveryChallanLineForPdf {
  id: number
  lotNo: string
  qualityName: string | null
  shadeName: string | null
  shadeCategory: string | null
  than: number
  finishSlipNo: number
}

export interface DeliveryChallanForPdf {
  challanNo: number
  date: string | Date
  transport: string | null
  lrNo: string | null
  vehicleNo: string | null
  showExtraCharges?: boolean
  party: { name: string; gstin?: string | null; address?: string | null; state?: string | null }
  lines: DeliveryChallanLineForPdf[]
}

// Freight when transport is anything other than "Open" / "By Truck".
// Checking when LR No is anything other than "Open". Both trimmed +
// lower-cased. Blank never triggers a charge (safe default for legacy DCs).
function transportTriggersFreight(t: string | null | undefined): boolean {
  const s = (t ?? '').trim().toLowerCase()
  if (!s) return false
  return s !== 'open' && s !== 'by truck'
}
function lrTriggersChecking(l: string | null | undefined): boolean {
  const s = (l ?? '').trim().toLowerCase()
  if (!s) return false
  return s !== 'open'
}

// Generates an A4 delivery-challan PDF that mirrors the print page layout —
// shade-category grouped table with sub-totals, declaration, 3-signature
// footer. Returns the jsPDF instance so callers can decide save vs print.
export function buildDeliveryChallanPdf(c: DeliveryChallanForPdf): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const marginL = 12
  const marginR = 12

  const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('en-IN')

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Kothari Synthetic Industries', marginL, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Tilwara Road, Jasol  ·  GSTIN 08AABFK2105R1Z8', marginL, 21)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(4, 120, 87) // emerald-700
  doc.text('DELIVERY CHALLAN', pageW - marginR, 16, { align: 'right' })

  // Divider
  doc.setDrawColor(30, 30, 30)
  doc.setLineWidth(0.6)
  doc.line(marginL, 25, pageW - marginR, 25)

  // Meta block
  doc.setTextColor(30, 30, 30)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('DELIVERED TO', marginL, 31)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(c.party.name, marginL, 36)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  let leftCursor = 40
  if (c.party.address) {
    doc.text(c.party.address, marginL, leftCursor)
    leftCursor += 4
  }
  const partyMeta = [c.party.state, c.party.gstin ? `GSTIN ${c.party.gstin}` : null].filter(Boolean).join(' · ')
  if (partyMeta) {
    doc.text(partyMeta, marginL, leftCursor)
    leftCursor += 4
  }
  const firstSlip = c.lines[0]?.finishSlipNo
  if (firstSlip) {
    doc.setTextColor(120, 120, 120)
    doc.text(`Source FP-${firstSlip}  ·  ${fmtDate(c.date)}`, marginL, leftCursor)
    doc.setTextColor(30, 30, 30)
  }

  // Right meta
  const rightX = pageW - marginR
  doc.setFontSize(8)
  const rightMeta: string[] = [
    `Challan No: ${c.challanNo}`,
    `Date: ${fmtDate(c.date)}`,
  ]
  if (c.transport) rightMeta.push(`Transport: ${c.transport}`)
  if (c.lrNo || c.vehicleNo) rightMeta.push(`LR / Vehicle: ${[c.lrNo, c.vehicleNo].filter(Boolean).join(' / ')}`)
  rightMeta.forEach((line, i) => {
    doc.text(line, rightX, 31 + i * 4, { align: 'right' })
  })

  // Group lines by shade category AND merge duplicate (lot, quality) rows
  // within each category so the printed challan shows one row per unique
  // lot-quality combo instead of every underlying FinishEntryLot slice.
  type Merged = { lotNo: string; qualityName: string | null; than: number; sliceCount: number }
  const byCat = new Map<string, Map<string, Merged>>()
  for (const l of c.lines) {
    const catKey = l.shadeCategory || 'Uncategorised'
    if (!byCat.has(catKey)) byCat.set(catKey, new Map())
    const bucket = byCat.get(catKey)!
    const key = `${l.lotNo}||${l.qualityName ?? ''}`
    const cur = bucket.get(key)
    if (cur) { cur.than += l.than; cur.sliceCount++ }
    else bucket.set(key, { lotNo: l.lotNo, qualityName: l.qualityName ?? null, than: l.than, sliceCount: 1 })
  }
  const cats = [...byCat.keys()].sort()

  const showCharges = !!c.showExtraCharges
  const hasFreight = transportTriggersFreight(c.transport)
  const hasChecking = lrTriggersChecking(c.lrNo)
  const transportLabel = (c.transport ?? '').trim() || '-'
  const lrLabel = (c.lrNo ?? '').trim() || (c.transport?.trim() ? 'Open' : '-')
  const transportCellText = `${transportLabel}\nLR ${lrLabel}`
  const chipsText = [hasFreight && 'Freight', hasChecking && 'Checking'].filter(Boolean).join(' + ') || '—'
  const dataColSpan = showCharges ? 6 : 5    // # + Lot + Quality + Transport + Than + (Charges)
  const subColSpan = showCharges ? 4 : 3     // colSpan on sub-total label

  const body: any[] = []
  let idx = 1
  let grandThan = 0
  for (const cat of cats) {
    const rows = [...byCat.get(cat)!.values()].sort((a, b) => a.lotNo.localeCompare(b.lotNo))
    body.push([
      { content: `> ${cat}`, colSpan: dataColSpan, styles: { fillColor: [245, 245, 245], fontStyle: 'bold', textColor: [30, 30, 30] } },
    ])
    let subTotal = 0
    for (const r of rows) {
      grandThan += r.than
      subTotal += r.than
      const row: any[] = [
        String(idx++),
        r.lotNo,
        r.qualityName ?? '-',
        { content: transportCellText, styles: { fontSize: 7 } },
        { content: String(r.than), styles: { halign: 'right' } },
      ]
      if (showCharges) row.push({ content: chipsText, styles: { fontSize: 7, textColor: hasFreight || hasChecking ? [146, 64, 14] : [140, 140, 140] } })
      body.push(row)
    }
    const subRow: any[] = [
      { content: `${cat} sub-total`, colSpan: subColSpan, styles: { fillColor: [245, 245, 245], fontStyle: 'bold' } },
      { content: String(subTotal), styles: { halign: 'right', fillColor: [245, 245, 245], fontStyle: 'bold' } },
    ]
    if (showCharges) subRow.push({ content: '', styles: { fillColor: [245, 245, 245] } })
    body.push(subRow)
  }
  const grandRow: any[] = [
    { content: 'Grand Total', colSpan: subColSpan, styles: { fillColor: [230, 230, 230], fontStyle: 'bold' } },
    { content: String(grandThan), styles: { halign: 'right', fillColor: [230, 230, 230], fontStyle: 'bold' } },
  ]
  if (showCharges) grandRow.push({ content: chipsText, styles: { fillColor: [230, 230, 230], fontStyle: 'bold', fontSize: 7 } })
  body.push(grandRow)

  const head: any[] = ['#', 'Lot No', 'Quality', 'Transport / LR', 'Than']
  if (showCharges) head.push('Extra Charges')

  autoTable(doc, {
    startY: 55,
    head: [head],
    body,
    margin: { left: marginL, right: marginR },
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.6, textColor: [30, 30, 30], lineColor: [200, 200, 200] },
    headStyles: { fillColor: [240, 240, 240], textColor: [30, 30, 30], fontStyle: 'bold' },
    columnStyles: showCharges
      ? {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 42, fontStyle: 'bold' },
          2: { cellWidth: 24 },
          3: { cellWidth: 40 },
          4: { cellWidth: 14, halign: 'right' },
          5: { cellWidth: 30 },
        }
      : {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 48, fontStyle: 'bold' },
          2: { cellWidth: 30 },
          3: { cellWidth: 50 },
          4: { halign: 'right' },
        },
  })

  if (showCharges && (hasFreight || hasChecking)) {
    const y = ((doc as any).lastAutoTable?.finalY || 100) + 4
    doc.setFontSize(8)
    doc.setTextColor(60, 60, 60)
    doc.setFont('helvetica', 'bold')
    doc.text('Extra Charges applicable:', marginL, y)
    doc.setFont('helvetica', 'normal')
    doc.text(
      `${[hasFreight && 'Freight', hasChecking && 'Checking'].filter(Boolean).join(' · ')} — billed separately.`,
      marginL + 42, y,
    )
  }

  const finalY = (doc as any).lastAutoTable.finalY || 100

  // Signature slots
  const sigY = Math.min(finalY + 25, doc.internal.pageSize.getHeight() - 30)
  const sigW = (pageW - marginL - marginR - 20) / 3
  const sigLabels = ['Prepared by', 'For KSI · Authorised signatory', 'Received by (party)']
  for (let i = 0; i < 3; i++) {
    const x = marginL + i * (sigW + 10)
    doc.setDrawColor(140, 140, 140)
    doc.setLineWidth(0.2)
    doc.line(x, sigY, x + sigW, sigY)
    doc.setFontSize(8)
    doc.setTextColor(60, 60, 60)
    doc.text(sigLabels[i], x + sigW / 2, sigY + 4, { align: 'center' })
  }

  return doc
}

export function downloadDeliveryChallanPdf(c: DeliveryChallanForPdf): void {
  const doc = buildDeliveryChallanPdf(c)
  doc.save(`challan-${c.challanNo}.pdf`)
}
