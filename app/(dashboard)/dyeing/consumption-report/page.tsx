'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')

type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom'

function getDateRange(period: Period, offset: number) {
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const fmtLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  switch (period) {
    case 'today': case 'yesterday': {
      const d = new Date(now)
      d.setDate(d.getDate() + offset + (period === 'yesterday' ? -1 : 0))
      const s = fmt(d)
      return { from: s, to: s, label: fmtLabel(d) }
    }
    case 'week': {
      const d = new Date(now)
      d.setDate(d.getDate() + offset * 7)
      const start = new Date(d); start.setDate(start.getDate() - start.getDay())
      const end = new Date(start); end.setDate(end.getDate() + 6)
      return { from: fmt(start), to: fmt(end), label: `${fmtLabel(start)} — ${fmtLabel(end)}` }
    }
    case 'month': {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      return { from: fmt(d), to: fmt(end), label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
    }
    case 'year': {
      const yr = now.getFullYear() + offset
      return { from: `${yr}-04-01`, to: `${yr + 1}-03-31`, label: `FY ${yr}-${(yr + 1) % 100}` }
    }
    default:
      return { from: fmt(now), to: fmt(now), label: 'Custom' }
  }
}

export default function ConsumptionReportPage() {
  const [period, setPeriod] = useState<Period>('month')
  const [offset, setOffset] = useState(0)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(() => {
    if (period === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo, label: `${customFrom} — ${customTo}` }
    return getDateRange(period, offset)
  }, [period, offset, customFrom, customTo])

  const { data, isLoading } = useSWR(
    range.from && range.to ? `/api/dyeing/consumption-report?from=${range.from}&to=${range.to}` : null,
    fetcher, { revalidateOnFocus: false }
  )

  function navigate(dir: number) {
    if (period === 'today' || period === 'yesterday') setOffset(prev => prev + dir)
    else if (period === 'week') setOffset(prev => prev + dir)
    else if (period === 'month') setOffset(prev => prev + dir)
    else if (period === 'year') setOffset(prev => prev + dir)
  }

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-4 mb-5">
        <BackButton />
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Consumption Report</h1>
      </div>

      {/* Period */}
      <div className="flex flex-wrap gap-2 mb-3">
        {(['today', 'yesterday', 'week', 'month', 'year', 'custom'] as Period[]).map(p => (
          <button key={p} onClick={() => { setPeriod(p); setOffset(0) }}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${period === p
              ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}>
            {p === 'today' ? 'Today' : p === 'yesterday' ? 'Yesterday' : p === 'week' ? 'Weekly' : p === 'month' ? 'Monthly' : p === 'year' ? 'Yearly' : 'Custom'}
          </button>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-sm bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">← Prev</button>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{range.label}</span>
        <button onClick={() => navigate(1)} className="text-sm bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">Next →</button>
        {period === 'custom' && (
          <div className="flex gap-2 ml-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-100" />
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-100" />
          </div>
        )}
      </div>

      {isLoading && <div className="p-12 text-center text-gray-400">Loading...</div>}

      {data && !isLoading && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Batches</p>
              <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{data.totalBatches}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Total Than</p>
              <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{data.totalThan}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Dyes Cost</p>
              <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{fmtINR(data.dyeTotal)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Auxiliary Cost</p>
              <p className="text-xl font-bold text-teal-600 dark:text-teal-400">{fmtINR(data.auxTotal)}</p>
            </div>
          </div>

          {/* Grand Total */}
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Grand Total</span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtINR(data.grandTotal)}</span>
          </div>

          {/* Dyes */}
          {data.dyes.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-purple-700 dark:text-purple-400 mb-2">Dyes ({data.dyes.length})</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-purple-50 dark:bg-purple-900/20 border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Chemical</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Consumed</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Rate</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {data.dyes.map((d: any, i: number) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-200 font-medium">{d.name}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{d.consumed} {d.unit}</td>
                        <td className="px-3 py-2 text-right text-gray-400">{d.rate > 0 ? fmtINR(d.rate) : '-'}</td>
                        <td className="px-3 py-2 text-right font-medium text-purple-600 dark:text-purple-400">{fmtINR(d.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-purple-50 dark:bg-purple-900/20 font-bold">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200" colSpan={3}>Dyes Total</td>
                      <td className="px-3 py-2 text-right text-purple-600 dark:text-purple-400">{fmtINR(data.dyeTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Auxiliary */}
          {data.auxiliary.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-teal-700 dark:text-teal-400 mb-2">Auxiliary ({data.auxiliary.length})</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-teal-50 dark:bg-teal-900/20 border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Chemical</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Consumed</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Rate</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {data.auxiliary.map((a: any, i: number) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-200 font-medium">{a.name}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{a.consumed} {a.unit}</td>
                        <td className="px-3 py-2 text-right text-gray-400">{a.rate > 0 ? fmtINR(a.rate) : '-'}</td>
                        <td className="px-3 py-2 text-right font-medium text-teal-600 dark:text-teal-400">{fmtINR(a.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-teal-50 dark:bg-teal-900/20 font-bold">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200" colSpan={3}>Auxiliary Total</td>
                      <td className="px-3 py-2 text-right text-teal-600 dark:text-teal-400">{fmtINR(data.auxTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {data.totalBatches === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">
              No dyeing entries found for this period.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
