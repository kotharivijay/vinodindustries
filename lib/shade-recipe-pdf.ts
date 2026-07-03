import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface ShadeRecipeItemForPdf {
  chemicalName: string
  unit: string
  quantity: number
}
export interface ShadeForPdf {
  name: string
  description?: string | null
  colorCategory?: string | null
  recipeItems: ShadeRecipeItemForPdf[]
}

// Builds an A4 PDF containing every selected shade's recipe. Each shade is
// printed as its own table (name + description + colorCategory header, then a
// two-column table: Chemical / Qty per 100 kg). Quantity is always rendered
// with three decimals per the shade-master convention.
export function buildShadeRecipesPdf(shades: ShadeForPdf[]): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginL = 12
  const marginR = 12
  const marginB = 15

  // Document title
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Dyeing Recipes', marginL, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text(
    `${shades.length} shade${shades.length === 1 ? '' : 's'}  ·  Generated ${new Date().toLocaleDateString('en-IN')}`,
    marginL,
    21,
  )
  doc.setTextColor(30, 30, 30)

  let cursorY = 28

  for (let i = 0; i < shades.length; i++) {
    const s = shades[i]

    // Space for the shade header + at least one row; page-break otherwise
    if (cursorY > pageH - marginB - 40) {
      doc.addPage()
      cursorY = 16
    }

    // Shade header
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(s.name, marginL, cursorY)
    if (s.colorCategory) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(90, 90, 90)
      const catX = marginL + doc.getTextWidth(s.name) + 3
      doc.text(`[${s.colorCategory}]`, catX, cursorY)
      doc.setTextColor(30, 30, 30)
    }
    cursorY += 4
    if (s.description) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(100, 100, 100)
      doc.text(s.description, marginL, cursorY)
      doc.setTextColor(30, 30, 30)
      cursorY += 4
    }

    if (s.recipeItems.length === 0) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(150, 150, 150)
      doc.text('No recipe items.', marginL, cursorY + 2)
      doc.setTextColor(30, 30, 30)
      cursorY += 10
    } else {
      const body = s.recipeItems.map((r, idx) => [
        String(idx + 1),
        r.chemicalName,
        {
          content: `${Number(r.quantity).toFixed(3)} ${r.unit}`.trim(),
          styles: { halign: 'right' as const },
        },
      ])

      autoTable(doc, {
        startY: cursorY + 1,
        head: [['#', 'Chemical', 'Qty / 100 kg']],
        body,
        margin: { left: marginL, right: marginR },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, textColor: [30, 30, 30], lineColor: [200, 200, 200] },
        headStyles: { fillColor: [240, 240, 240], textColor: [30, 30, 30], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 90, fontStyle: 'bold' },
          2: { halign: 'right' },
        },
      })
      cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY + 20) + 6
    }
  }

  return doc
}

export function downloadShadeRecipesPdf(shades: ShadeForPdf[]): void {
  const doc = buildShadeRecipesPdf(shades)
  const suffix = shades.length === 1 ? shades[0].name.replace(/[^\w-]+/g, '_') : `${shades.length}-recipes`
  doc.save(`dyeing-recipe-${suffix}.pdf`)
}
