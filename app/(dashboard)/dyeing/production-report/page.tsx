'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

type View = 'jet' | 'operator' | 'quality' | 'daily' | 'entries'
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

function getDateRange(period: Period, offset: number): { from: string; to: string; label: string } {
  const now = new Date()
  now.setDate(now.getDate() + offset)
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  switch (period) {
    case 'today':
    case 'yesterday': {
      const d = new Date(now)
      if (period === 'yesterday') d.setDate(d.getDate() - 1)
      const s = fmt(d)
      return { from: s, to: s, label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
    }
    case 'week': {
      const start = new Date(now)
      start.setDate(start.getDate() - start.getDay())
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      return { from: fmt(start), to: fmt(end), label: `${fmtDate(fmt(start))} — ${fmtDate(fmt(end))}` }
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: fmt(start), to: fmt(end), label: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
    }
    default:
      return { from: fmt(now), to: fmt(now), label: 'Custom' }
  }
}

export default function ProductionReportPage() {
  const [period, setPeriod] = useState<Period>('today')
  const [dayOffset, setDayOffset] = useState(0)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [view, setView] = useState<View>('entries')
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set())

  const range = useMemo(() => {
    if (period === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo, label: `${fmtDate(customFrom)} — ${fmtDate(customTo)}` }
    return getDateRange(period, dayOffset)
  }, [period, dayOffset, customFrom, customTo])

  const { data, isLoading } = useSWR(
    range.from && range.to ? `/api/dyeing/production-report?from=${range.from}&to=${range.to}` : null,
    fetcher, { revalidateOnFocus: false }
  )

  function toggleEntry(id: number) {
    setExpandedEntries(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  function navigate(dir: number) {
    if (period === 'today' || period === 'yesterday') setDayOffset(prev => prev + dir)
    else if (period === 'week') setDayOffset(prev => prev + dir * 7)
    else if (period === 'month') setDayOffset(prev => prev + dir * 30)
  }

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-4 mb-5">
        <BackButton />
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Dyeing Production Report</h1>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2 mb-3">
        {(['today', 'yesterday', 'week', 'month', 'custom'] as Period[]).map(p => (
          <button key={p} onClick={() => { setPeriod(p); setDayOffset(0) }}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${period === p
              ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}>
            {p === 'today' ? 'Today' : p === 'yesterday' ? 'Yesterday' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Custom'}
          </button>
        ))}
      </div>

      {/* Navigation arrows + date label */}
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
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-5">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Batches</p>
              <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{data.summary.totalBatches}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Than</p>
              <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{data.summary.totalThan}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Cost</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmtINR(data.summary.totalCost)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Done</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400">{data.summary.doneCount}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Patchy</p>
              <p className="text-xl font-bold text-red-600 dark:text-red-400">{data.summary.patchyCount}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Re-Dyed</p>
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{data.summary.reDyeCount}</p>
            </div>
          </div>

          {/* View tabs */}
          <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
            {([['entries', 'All Entries'], ['jet', 'Jet (Machine)'], ['operator', 'Operator'], ['quality', 'Quality'], ['daily', 'Daily']] as [View, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setView(k)}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition -mb-px whitespace-nowrap ${view === k
                  ? 'border-purple-600 text-purple-600 dark:text-purple-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Jet view */}
          {view === 'jet' && (
            <div className="space-y-2">
              {/* Bar chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 mb-3">
                <h3 className="text-xs font-bold text-gray-600 dark:text-gray-300 mb-3">Jet vs Batches</h3>
                <div className="space-y-2">
                  {data.byMachine.map((m: any) => {
                    const maxBatches = Math.max(...data.byMachine.map((x: any) => x.batches), 1)
                    const pct = (m.batches / maxBatches) * 100
                    return (
                      <div key={m.name} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-600 dark:text-gray-300 w-20 truncate text-right">{m.name}</span>
                        <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 relative overflow-hidden">
                          <div className="bg-purple-500 h-full rounded-full flex items-center justify-end px-2" style={{ width: `${Math.max(pct, 8)}%` }}>
                            <span className="text-[9px] text-white font-bold">{m.batches}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-400 w-14 text-right">{m.than}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              {data.byMachine.map((m: any) => (
                <div key={m.name} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{m.name}</span>
                  <div className="text-right">
                    <span className="text-xs text-gray-500">{m.batches} batches · {m.than}</span>
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 ml-2">{fmtINR(m.cost)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Operator view */}
          {view === 'operator' && (
            <div className="space-y-2">
              {data.byOperator.map((o: any) => (
                <div key={o.name} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{o.name}</span>
                  <div className="text-right">
                    <span className="text-xs text-gray-500">{o.batches} batches · {o.than}</span>
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 ml-2">{fmtINR(o.cost)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quality view */}
          {view === 'quality' && (
            <div className="space-y-2">
              {data.byQuality.map((q: any) => (
                <div key={q.name} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{q.name}</span>
                  <div className="text-right">
                    <span className="text-xs text-gray-500">{q.batches} batches · {q.than}</span>
                    <span className="text-xs font-medium text-teal-600 dark:text-teal-400 ml-2">{q.cost > 0 ? fmtINR(Math.round(q.cost / q.than)) + '/T' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Daily view */}
          {view === 'daily' && (
            <div className="space-y-2">
              {data.byDate.map((d: any) => (
                <div key={d.date} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{fmtDate(d.date)}</span>
                  <div className="text-right">
                    <span className="text-xs text-gray-500">{d.batches} batches · {d.than}</span>
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 ml-2">{fmtINR(d.cost)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* All Entries view — expandable with full detail */}
          {view === 'entries' && (
            <div className="space-y-2">
              {data.entries.map((e: any) => {
                const isOpen = expandedEntries.has(e.id)
                return (
                  <div key={e.id} className={`bg-white dark:bg-gray-800 rounded-xl border shadow-sm overflow-hidden ${e.isReDyed ? 'border-amber-200 dark:border-amber-800' : e.status === 'patchy' ? 'border-red-200 dark:border-red-800' : 'border-gray-100 dark:border-gray-700'}`}>
                    <button onClick={() => toggleEntry(e.id)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <Link href={`/dyeing/${e.id}`} onClick={ev => ev.stopPropagation()} className="text-sm font-bold text-purple-600 dark:text-purple-400 hover:underline">Slip {e.slipNo}</Link>
                          {e.batchNo && <span className="text-[10px] bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-500">B{e.batchNo}</span>}
                          {e.foldNo && <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">F{e.foldNo}</span>}
                          {e.isPcJob && <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">PC</span>}
                          {e.isReDyed && <span className="text-[9px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">Re-Dye ×{e.totalRounds}</span>}
                          {e.status === 'patchy' && <span className="text-[9px] text-red-500 font-bold">Patchy</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-400">{fmtDate(e.date)}</span>
                          {e.shade && <span className="text-[10px] text-purple-500">{e.shade}</span>}
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <div>
                          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{e.than}</p>
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtINR(e.totalCost)}</p>
                        </div>
                        <span className={`text-gray-400 text-[10px] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-2">
                        {/* Party / Quality / Machine / Operator */}
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          {e.party && <div><span className="text-gray-400">Party:</span> <span className="text-gray-700 dark:text-gray-200 font-medium">{e.party}</span></div>}
                          {e.quality && <div><span className="text-gray-400">Quality:</span> <span className="text-gray-700 dark:text-gray-200 font-medium">{e.quality}</span></div>}
                          {e.machine && <div><span className="text-gray-400">Jet:</span> <span className="text-gray-700 dark:text-gray-200 font-medium">{e.machine}</span></div>}
                          {e.operator && <div><span className="text-gray-400">Operator:</span> <span className="text-gray-700 dark:text-gray-200 font-medium">{e.operator}</span></div>}
                        </div>

                        {/* Lots */}
                        <div className="flex flex-wrap gap-1.5">
                          {e.lots.map((l: any, li: number) => (
                            <span key={li} className="text-[10px] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-full font-medium">
                              {l.lotNo}{l.marka ? ` [${l.marka}]` : ''} ({l.than})
                            </span>
                          ))}
                        </div>

                        {/* Notes */}
                        {e.notes && <p className="text-[10px] text-gray-500 italic">{e.notes}</p>}

                        {/* Additions / Re-Dye */}
                        {e.additions.length > 0 && (
                          <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-2 bg-amber-50/50 dark:bg-amber-900/10 space-y-1">
                            <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">Additions / Re-Dye ({e.additions.length})</p>
                            {e.additions.map((a: any, ai: number) => (
                              <div key={ai} className="text-[10px] flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-gray-700 dark:text-gray-200">Round {a.roundNo}</span>
                                  <span className="text-gray-400">({a.type})</span>
                                  {a.defectType && <span className="text-red-500">{a.defectType}</span>}
                                  {a.reason && <span className="text-gray-400 italic">{a.reason}</span>}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {a.machine && <span className="text-gray-400">{a.machine}</span>}
                                  <span className="text-amber-600 font-medium">{a.chemCount} chems · {fmtINR(Math.round(a.cost))}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Cost breakdown */}
                        <div className="flex gap-2 text-[10px]">
                          <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded">Round 1: {fmtINR(e.cost)}</span>
                          {e.additionsCost > 0 && <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded">Additions: +{fmtINR(e.additionsCost)}</span>}
                          <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded font-bold">Total: {fmtINR(e.totalCost)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
