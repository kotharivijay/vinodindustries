'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface BatchDetail {
  batchNo: number | null
  slipNo: number
  date: string
  shade: string
  than: number
  cost: number
  costPerThan: number
}

interface FoldGroup {
  foldNo: string
  slips: number
  than: number
  cost: number
  avgPerThan: number
  batches: BatchDetail[]
}

interface ShadeGroup {
  shade: string
  than: number
  cost: number
  avgPerThan: number
  count: number
}

interface CostReport {
  party: string
  totalSlips: number
  totalThan: number
  totalCost: number
  avgCostPerThan: number
  folds: FoldGroup[]
  shades: ShadeGroup[]
}

export default function DyeingCostReportPage() {
  const { data: parties = [] } = useSWR<{ id: number; name: string; tag: string | null }[]>('/api/masters/parties', fetcher, {
    revalidateOnFocus: false,
  })

  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null)
  const [partySearch, setPartySearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set())
  const dropRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handler)
      document.addEventListener('touchstart', handler as EventListener)
    }
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler as EventListener)
    }
  }, [dropdownOpen])

  const filteredParties = useMemo(() => {
    const q = partySearch.toLowerCase()
    return parties.filter(p => !q || p.name.toLowerCase().includes(q))
  }, [parties, partySearch])

  const selectedParty = parties.find(p => p.id === selectedPartyId)

  const { data: report, isLoading } = useSWR<CostReport>(
    selectedPartyId ? `/api/dyeing/cost-report?partyId=${selectedPartyId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  function toggleFold(foldNo: string) {
    setExpandedFolds(prev => {
      const next = new Set(prev)
      if (next.has(foldNo)) next.delete(foldNo); else next.add(foldNo)
      return next
    })
  }

  const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-4 mb-5">
        <BackButton />
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Dyeing Cost Report</h1>
      </div>

      {/* Party Selector */}
      <div ref={dropRef} className="relative mb-6 max-w-md">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Select Party</label>
        <button
          onClick={() => { setDropdownOpen(!dropdownOpen); setPartySearch('') }}
          className="w-full flex items-center justify-between border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:border-purple-400 transition"
        >
          <span>{selectedParty ? selectedParty.name : 'Choose party...'}</span>
          <span className="text-gray-400">▼</span>
        </button>

        {dropdownOpen && (
          <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl max-h-64 flex flex-col">
            <input
              autoFocus
              type="text"
              placeholder="Search party..."
              value={partySearch}
              onChange={e => setPartySearch(e.target.value)}
              className="w-full px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-700 bg-transparent focus:outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400"
            />
            <div className="overflow-y-auto flex-1">
              {filteredParties.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPartyId(p.id); setDropdownOpen(false); setExpandedFolds(new Set()) }}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/20 flex items-center justify-between ${selectedPartyId === p.id ? 'bg-purple-50 dark:bg-purple-900/20' : ''}`}
                >
                  <span className="text-gray-800 dark:text-gray-200">{p.name}</span>
                  {p.tag && <span className="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{p.tag}</span>}
                </button>
              ))}
              {filteredParties.length === 0 && <p className="px-3 py-4 text-xs text-gray-400 text-center">No parties found</p>}
            </div>
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && <div className="p-12 text-center text-gray-400">Loading cost data...</div>}

      {/* Report */}
      {report && !isLoading && (
        <div className="space-y-4">
          {/* Overall Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Slips</p>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{report.totalSlips}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Total Than</p>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{report.totalThan.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Total Cost</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{fmtINR(report.totalCost)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
              <p className="text-[10px] text-gray-500 uppercase">Avg Cost/Than</p>
              <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{fmtINR(report.avgCostPerThan)}</p>
            </div>
          </div>

          {report.totalSlips === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">
              No dyeing entries found for this party.
            </div>
          )}

          {/* Fold-wise — expandable */}
          {report.folds.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Fold-wise Cost</h2>
              <div className="space-y-2">
                {report.folds.map(f => {
                  const isOpen = expandedFolds.has(f.foldNo)
                  return (
                    <div key={f.foldNo} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                      <button
                        onClick={() => toggleFold(f.foldNo)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                      >
                        <div className="flex items-center gap-2 text-left">
                          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">Fold {f.foldNo}</span>
                          <span className="text-[10px] text-gray-400">{f.slips} slips · {f.than}T</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{fmtINR(f.cost)}</span>
                          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{fmtINR(f.avgPerThan)}/T</span>
                          <span className={`text-gray-400 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-gray-100 dark:border-gray-700">
                          <div className="divide-y divide-gray-50 dark:divide-gray-700">
                            {f.batches.map((b, bi) => (
                              <div key={bi} className="px-4 py-2.5 flex items-center justify-between">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                      {b.batchNo ? `B${b.batchNo}` : `Slip ${b.slipNo}`}
                                    </span>
                                    <span className="text-[10px] text-gray-400">{new Date(b.date).toLocaleDateString('en-IN')}</span>
                                  </div>
                                  <p className="text-[10px] text-purple-600 dark:text-purple-400">{b.shade}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-gray-600 dark:text-gray-300">{b.than}T · {fmtINR(b.cost)}</p>
                                  <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{fmtINR(b.costPerThan)}/T</p>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fold Total</span>
                            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{f.than}T · {fmtINR(f.cost)} · {fmtINR(f.avgPerThan)}/T</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Shade-wise */}
          {report.shades.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Shade-wise Cost</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {report.shades.map((s, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{s.shade}</span>
                        <span className="text-[10px] text-gray-400 ml-2">{s.count} slips</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-gray-500">{s.than}T · {fmtINR(s.cost)}</span>
                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 ml-2">{fmtINR(s.avgPerThan)}/T</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
