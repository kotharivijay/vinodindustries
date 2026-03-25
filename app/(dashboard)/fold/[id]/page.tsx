'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import useSWR from 'swr'
import * as XLSX from 'xlsx'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface FoldBatchLot {
  id: number
  lotNo: string
  than: number
  party?: { name: string }
  quality?: { name: string }
}

interface FoldBatch {
  id: number
  batchNo: number
  shadeName?: string
  shade?: { name: string }
  lots: FoldBatchLot[]
}

interface FoldProgram {
  id: number
  foldNo: string
  date: string
  status: 'draft' | 'confirmed'
  notes?: string
  batches: FoldBatch[]
}

export default function FoldDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const { data: program, isLoading, mutate } = useSWR<FoldProgram>(`/api/fold/${id}`, fetcher)
  const [confirming, setConfirming] = useState(false)

  async function confirmProgram() {
    setConfirming(true)
    await fetch(`/api/fold/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    })
    mutate()
    setConfirming(false)
  }

  function exportXLSX() {
    if (!program) return
    const wb = XLSX.utils.book_new()

    // Summary sheet
    const summaryRows: any[][] = [
      ['Fold Program', program.foldNo],
      ['Date', new Date(program.date).toLocaleDateString('en-IN')],
      ['Status', program.status],
      ['Notes', program.notes ?? ''],
      [],
    ]
    for (const batch of program.batches) {
      const shade = batch.shade?.name ?? batch.shadeName ?? '-'
      summaryRows.push([`Batch ${batch.batchNo}`, `Shade: ${shade}`])
      summaryRows.push(['Lot No', 'Party', 'Quality', 'Than'])
      for (const lot of batch.lots) {
        summaryRows.push([lot.lotNo, lot.party?.name ?? '-', lot.quality?.name ?? '-', lot.than])
      }
      summaryRows.push(['', '', 'Batch Total:', batch.lots.reduce((s, l) => s + l.than, 0)])
      summaryRows.push([])
    }
    const totalThan = program.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)
    summaryRows.push(['', '', 'GRAND TOTAL:', totalThan])

    const ws = XLSX.utils.aoa_to_sheet(summaryRows)
    XLSX.utils.book_append_sheet(wb, ws, 'Fold Program')
    XLSX.writeFile(wb, `fold-${program.foldNo}.xlsx`)
  }

  async function exportPDF() {
    if (!program) return
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'portrait' })

    doc.setFontSize(16)
    doc.text(`Fold Program: ${program.foldNo}`, 14, 15)
    doc.setFontSize(10)
    doc.text(`Date: ${new Date(program.date).toLocaleDateString('en-IN')}   Status: ${program.status}`, 14, 22)
    if (program.notes) doc.text(`Notes: ${program.notes}`, 14, 28)

    let y = program.notes ? 34 : 28

    for (const batch of program.batches) {
      const shade = batch.shade?.name ?? batch.shadeName ?? '-'
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(`Batch ${batch.batchNo} — Shade: ${shade}`, 14, y)
      doc.setFont('helvetica', 'normal')
      y += 2

      autoTable(doc, {
        head: [['Lot No', 'Party', 'Quality', 'Than']],
        body: [
          ...batch.lots.map(l => [l.lotNo, l.party?.name ?? '-', l.quality?.name ?? '-', l.than]),
          ['', '', 'Batch Total', batch.lots.reduce((s, l) => s + l.than, 0)],
        ],
        startY: y,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [79, 70, 229] },
        columnStyles: { 3: { fontStyle: 'bold' } },
        margin: { left: 14, right: 14 },
        didDrawPage: (data: any) => { y = data.cursor.y },
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    const totalThan = program.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)
    doc.setFont('helvetica', 'bold')
    doc.text(`Grand Total: ${totalThan} than`, 14, y)

    doc.save(`fold-${program.foldNo}.pdf`)
  }

  async function printProgram() {
    if (!program) return
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'portrait' })

    doc.setFontSize(16)
    doc.text(`Fold Program: ${program.foldNo}`, 14, 15)
    doc.setFontSize(10)
    doc.text(`Date: ${new Date(program.date).toLocaleDateString('en-IN')}   Status: ${program.status}`, 14, 22)
    if (program.notes) doc.text(`Notes: ${program.notes}`, 14, 28)

    let y = program.notes ? 34 : 28

    for (const batch of program.batches) {
      const shade = batch.shade?.name ?? batch.shadeName ?? '-'
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(`Batch ${batch.batchNo} — Shade: ${shade}`, 14, y)
      doc.setFont('helvetica', 'normal')
      y += 2

      autoTable(doc, {
        head: [['Lot No', 'Party', 'Quality', 'Than']],
        body: [
          ...batch.lots.map(l => [l.lotNo, l.party?.name ?? '-', l.quality?.name ?? '-', l.than]),
          ['', '', 'Batch Total', batch.lots.reduce((s, l) => s + l.than, 0)],
        ],
        startY: y,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [79, 70, 229] },
        columnStyles: { 3: { fontStyle: 'bold' } },
        margin: { left: 14, right: 14 },
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    const totalThan = program.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)
    doc.setFont('helvetica', 'bold')
    doc.text(`Grand Total: ${totalThan} than`, 14, y)

    // Open print dialog
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    const win = window.open(url)
    win?.print()
  }

  if (isLoading) return <div className="p-8 text-gray-400">Loading...</div>
  if (!program) return <div className="p-8 text-red-500">Not found</div>

  const totalThan = program.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-800">{program.foldNo}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              program.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
            }`}>
              {program.status}
            </span>
          </div>
          <p className="text-sm text-gray-500">
            {new Date(program.date).toLocaleDateString('en-IN')} &middot; {program.batches.length} batch{program.batches.length !== 1 ? 'es' : ''} &middot; {totalThan} than
          </p>
        </div>
        <div className="flex gap-2">
          {program.status === 'draft' && (
            <button
              onClick={confirmProgram}
              disabled={confirming}
              className="bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Confirm
            </button>
          )}
          <button onClick={exportXLSX} className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-emerald-700">⬇ XLSX</button>
          <button onClick={exportPDF} className="bg-red-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-red-700">⬇ PDF</button>
          <button onClick={printProgram} className="bg-gray-700 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-gray-800">🖨 Print</button>
        </div>
      </div>

      {program.notes && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-sm text-gray-700">
          {program.notes}
        </div>
      )}

      {/* Batches */}
      <div className="space-y-4">
        {program.batches.map(batch => {
          const shade = batch.shade?.name ?? batch.shadeName
          const batchTotal = batch.lots.reduce((s, l) => s + l.than, 0)
          return (
            <div key={batch.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-indigo-50 px-4 py-2 flex items-center justify-between">
                <div>
                  <span className="font-bold text-indigo-700 text-sm">Batch {batch.batchNo}</span>
                  {shade && <span className="ml-2 text-xs text-gray-600 bg-white border border-gray-200 px-2 py-0.5 rounded-full">{shade}</span>}
                </div>
                <span className="text-sm font-bold text-indigo-600">{batchTotal} than</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2">Lot No</th>
                    <th className="text-left px-4 py-2">Party</th>
                    <th className="text-left px-4 py-2">Quality</th>
                    <th className="text-right px-4 py-2">Than</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.lots.map(lot => (
                    <tr key={lot.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-indigo-700">{lot.lotNo}</td>
                      <td className="px-4 py-2 text-gray-600">{lot.party?.name ?? '-'}</td>
                      <td className="px-4 py-2 text-gray-600">{lot.quality?.name ?? '-'}</td>
                      <td className="px-4 py-2 text-right font-bold text-gray-800">{lot.than}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-indigo-50">
                    <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-right text-gray-600">Batch Total:</td>
                    <td className="px-4 py-2 text-right font-bold text-indigo-700">{batchTotal}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        })}
      </div>

      {/* Grand total */}
      <div className="mt-4 bg-indigo-600 text-white rounded-xl px-6 py-4 flex justify-between items-center">
        <span className="font-semibold">Grand Total</span>
        <span className="text-2xl font-bold">{totalThan} than</span>
      </div>
    </div>
  )
}
