'use client'

import { useEffect, useMemo } from 'react'
import { downloadDeliveryChallanPdf } from '@/lib/delivery-challan-pdf'

interface Line {
  id: number
  lotNo: string
  qualityName: string | null
  shadeName: string | null
  shadeCategory: string | null
  than: number
  finishSlipNo: number
}
interface Challan {
  id: number
  challanNo: number
  date: string
  transport: string | null
  lrNo: string | null
  vehicleNo: string | null
  party: { name: string; tag: string | null; gstin: string | null; address: string | null; state: string | null }
  lines: Line[]
}

export default function PrintClient({ challan }: { challan: Challan }) {
  // Trigger the print dialog on mount so operators only click Print in the
  // parent page — the sub-window opens ready to print.
  useEffect(() => {
    const t = setTimeout(() => window.print(), 250)
    return () => clearTimeout(t)
  }, [])

  // Group lines by shade category AND merge duplicate (lot, quality) rows
  // so the printed challan shows one row per unique lot-quality within a
  // category, summing than across all underlying FinishEntryLot slices.
  type MergedRow = { lotNo: string; qualityName: string | null; than: number; sliceCount: number }
  const groups = useMemo(() => {
    const m = new Map<string, Map<string, MergedRow>>()
    for (const l of challan.lines) {
      const catKey = l.shadeCategory || 'Uncategorised'
      if (!m.has(catKey)) m.set(catKey, new Map())
      const bucket = m.get(catKey)!
      const key = `${l.lotNo}||${l.qualityName ?? ''}`
      const cur = bucket.get(key)
      if (cur) { cur.than += l.than; cur.sliceCount++ }
      else bucket.set(key, { lotNo: l.lotNo, qualityName: l.qualityName ?? null, than: l.than, sliceCount: 1 })
    }
    return [...m.entries()].map(
      ([cat, bucket]) => [cat, [...bucket.values()].sort((a, b) => a.lotNo.localeCompare(b.lotNo))] as const,
    ).sort(([a], [b]) => a.localeCompare(b))
  }, [challan.lines])

  const grandThan = challan.lines.reduce((s, l) => s + l.than, 0)
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN')

  return (
    <div className="min-h-screen bg-white text-gray-900 p-6 print:p-3">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white; }
        }
      `}</style>

      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-start border-b-2 border-gray-800 pb-3">
          <div>
            <div className="text-2xl font-bold">Kothari Synthetic Industries</div>
            <div className="text-xs text-gray-600 mt-0.5">Tilwara Road, Jasol · GSTIN 08AABFK2105R1Z8</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold uppercase tracking-wide text-emerald-700">Delivery Challan</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
          <div>
            <div className="text-xs text-gray-500 uppercase">Delivered to</div>
            <div className="font-semibold">{challan.party.name}</div>
            {challan.party.address && <div className="text-xs text-gray-600">{challan.party.address}</div>}
            {(challan.party.state || challan.party.gstin) && (
              <div className="text-xs text-gray-600">
                {challan.party.state}{challan.party.state && challan.party.gstin ? ' · ' : ''}
                {challan.party.gstin && <>GSTIN {challan.party.gstin}</>}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-1">
              Source FP{challan.lines[0] ? '-' + challan.lines[0].finishSlipNo : ''} · {fmtDate(challan.date)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs"><span className="text-gray-500">Challan No</span> <span className="font-bold">{challan.challanNo}</span></div>
            <div className="text-xs"><span className="text-gray-500">Date</span> {fmtDate(challan.date)}</div>
            {challan.transport && <div className="text-xs"><span className="text-gray-500">Transport</span> {challan.transport}</div>}
            {(challan.lrNo || challan.vehicleNo) && (
              <div className="text-xs">
                <span className="text-gray-500">LR / Vehicle</span> {[challan.lrNo, challan.vehicleNo].filter(Boolean).join(' / ')}
              </div>
            )}
          </div>
        </div>

        <table className="w-full mt-4 border-collapse text-xs">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="border border-gray-300 px-2 py-1 text-left">#</th>
              <th className="border border-gray-300 px-2 py-1 text-left">Lot No</th>
              <th className="border border-gray-300 px-2 py-1 text-left">Quality</th>
              <th className="border border-gray-300 px-2 py-1 text-right">Than</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Running row counter across all category groups so numbering
              // stays sequential even after de-duplication.
              let runningIdx = 0
              return groups.map(([cat, rows], gi) => {
                const subTotal = rows.reduce((s, r) => s + r.than, 0)
                return (
                  <>
                    <tr key={`cat-${gi}`} className="bg-gray-50">
                      <td className="border border-gray-300 px-2 py-1 font-semibold" colSpan={4}>
                        {cat}
                      </td>
                    </tr>
                    {rows.map(r => {
                      runningIdx++
                      return (
                        <tr key={`${cat}-${r.lotNo}-${r.qualityName ?? ''}`}>
                          <td className="border border-gray-300 px-2 py-1">{runningIdx}</td>
                          <td className="border border-gray-300 px-2 py-1 font-mono">{r.lotNo}</td>
                          <td className="border border-gray-300 px-2 py-1">{r.qualityName ?? '-'}</td>
                          <td className="border border-gray-300 px-2 py-1 text-right">{r.than}</td>
                        </tr>
                      )
                    })}
                    <tr key={`sub-${gi}`} className="font-semibold bg-gray-50">
                      <td className="border border-gray-300 px-2 py-1" colSpan={3}>{cat} sub-total</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{subTotal}</td>
                    </tr>
                  </>
                )
              })
            })()}
            <tr className="font-bold bg-gray-100">
              <td className="border border-gray-300 px-2 py-1" colSpan={3}>Grand Total</td>
              <td className="border border-gray-300 px-2 py-1 text-right">{grandThan}</td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-3 gap-6 mt-12 text-xs">
          <div className="text-center"><div className="border-t border-gray-400 pt-1">Prepared by</div></div>
          <div className="text-center"><div className="border-t border-gray-400 pt-1">For KSI · Authorised signatory</div></div>
          <div className="text-center"><div className="border-t border-gray-400 pt-1">Received by (party)</div></div>
        </div>

        <div className="mt-8 no-print text-right print:hidden flex justify-end gap-2">
          <button
            onClick={() => downloadDeliveryChallanPdf(challan)}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
          >
            Download PDF
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            Print
          </button>
        </div>
      </div>
    </div>
  )
}
