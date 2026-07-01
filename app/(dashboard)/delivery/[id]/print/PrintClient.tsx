'use client'

import { useEffect, useMemo } from 'react'

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
  party: { name: string; tag: string | null }
  lines: Line[]
}

export default function PrintClient({ challan }: { challan: Challan }) {
  // Trigger the print dialog on mount so operators only click Print in the
  // parent page — the sub-window opens ready to print.
  useEffect(() => {
    const t = setTimeout(() => window.print(), 250)
    return () => clearTimeout(t)
  }, [])

  // Group lines by shade category so the printed challan matches the
  // mockup's Dark / Light / Medium sub-totals layout.
  const groups = useMemo(() => {
    const m = new Map<string, Line[]>()
    for (const l of challan.lines) {
      const k = l.shadeCategory || 'Uncategorised'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(l)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
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
            <div className="text-xs text-gray-600 mt-0.5">Jasol Road, Pali, Rajasthan · GSTIN 08AAAAA0000A1Z5</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold uppercase tracking-wide text-emerald-700">Delivery Challan</div>
            <div className="text-xs text-gray-600 mt-0.5">Job-work · Not for sale</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
          <div>
            <div className="text-xs text-gray-500 uppercase">Delivered to</div>
            <div className="font-semibold">{challan.party.name}</div>
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
            {groups.map(([cat, rows], gi) => {
              const startIdx = challan.lines.findIndex(l => l.id === rows[0].id) + 1
              const subTotal = rows.reduce((s, r) => s + r.than, 0)
              return (
                <>
                  <tr key={`cat-${gi}`} className="bg-gray-50">
                    <td className="border border-gray-300 px-2 py-1 font-semibold" colSpan={4}>
                      ▸ {cat}
                    </td>
                  </tr>
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td className="border border-gray-300 px-2 py-1">{startIdx + i}</td>
                      <td className="border border-gray-300 px-2 py-1 font-mono">{r.lotNo}</td>
                      <td className="border border-gray-300 px-2 py-1">{r.qualityName ?? '-'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-right">{r.than}</td>
                    </tr>
                  ))}
                  <tr key={`sub-${gi}`} className="font-semibold bg-gray-50">
                    <td className="border border-gray-300 px-2 py-1" colSpan={3}>{cat} sub-total</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{subTotal}</td>
                  </tr>
                </>
              )
            })}
            <tr className="font-bold bg-gray-100">
              <td className="border border-gray-300 px-2 py-1" colSpan={3}>Grand Total</td>
              <td className="border border-gray-300 px-2 py-1 text-right">{grandThan}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 text-xs text-gray-700 leading-relaxed">
          <strong>Declaration:</strong> The above goods are being sent back after job-work (dyeing &amp; finishing)
          under the GST job-work provisions. No sale involved.
        </div>

        <div className="grid grid-cols-3 gap-6 mt-12 text-xs">
          <div className="text-center"><div className="border-t border-gray-400 pt-1">Prepared by</div></div>
          <div className="text-center"><div className="border-t border-gray-400 pt-1">For KSI · Authorised signatory</div></div>
          <div className="text-center"><div className="border-t border-gray-400 pt-1">Received by (party)</div></div>
        </div>

        <div className="mt-8 no-print text-right print:hidden">
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
