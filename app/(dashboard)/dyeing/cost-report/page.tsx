'use client'

import { useState, useMemo, useRef, useEffect, Fragment } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const shadeCategoryBadge: Record<string, string> = {
  Light: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
  Medium: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  Dark: 'bg-gray-800 dark:bg-gray-900 text-gray-100',
}

function ShadeCategoryBadge({ category }: { category?: string | null }) {
  if (!category) return null
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${shadeCategoryBadge[category] ?? 'bg-gray-100 text-gray-600'}`}>
      {category}
    </span>
  )
}

interface ChemItem {
  name: string
  quantity: number | null
  unit: string
  cost: number
}

interface BatchDetail {
  id: number
  batchNo: number | null
  slipNo: number
  date: string
  shade: string
  colorCategory?: string | null
  than: number
  cost: number
  dyeCost: number
  auxCost: number
  costPerThan: number
  dyes: ChemItem[]
  auxiliary: ChemItem[]
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
  colorCategory?: string | null
  than: number
  cost: number
  avgPerThan: number
  count: number
}

interface QualityGroup {
  quality: string
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
  qualities: QualityGroup[]
}

export default function DyeingCostReportPage() {
  const { data: parties = [] } = useSWR<{ id: number; name: string; tag: string | null }[]>('/api/masters/parties', fetcher, {
    revalidateOnFocus: false,
  })

  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null)
  const [partySearch, setPartySearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set())
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())
  // Shade drill-down popup: which shade label is open, list vs compare view,
  // and which slips are expanded inside the list view.
  const [shadeModal, setShadeModal] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState(false)
  const [modalExpanded, setModalExpanded] = useState<Set<number>>(new Set())
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

  // Close the shade popup on Escape
  useEffect(() => {
    if (!shadeModal) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShadeModal(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [shadeModal])

  // All batches of the open shade, across folds, with foldNo attached
  const modalBatches = useMemo(() => {
    if (!report || !shadeModal) return []
    return report.folds
      .flatMap(f => f.batches.filter(b => b.shade === shadeModal).map(b => ({ ...b, foldNo: f.foldNo })))
      .sort((a, b) => a.slipNo - b.slipNo)
  }, [report, shadeModal])

  const modalShade = report?.shades.find(s => s.shade === shadeModal) ?? null

  // Compare matrix: union of chemical names (dyes first, in order of first
  // appearance), with per-slip qty/cost per row
  const compareRows = useMemo(() => {
    const rows: { name: string; kind: 'dye' | 'aux'; cells: ({ quantity: number | null; unit: string; cost: number } | null)[] }[] = []
    const idx = new Map<string, number>()
    const add = (kind: 'dye' | 'aux', c: ChemItem, bi: number) => {
      const key = `${kind}|${c.name}`
      let i = idx.get(key)
      if (i == null) {
        i = rows.length
        idx.set(key, i)
        rows.push({ name: c.name, kind, cells: modalBatches.map(() => null) })
      }
      const cell = rows[i].cells[bi]
      // A slip can list the same chemical twice (e.g. addition rounds) — sum it
      rows[i].cells[bi] = cell
        ? { quantity: (cell.quantity ?? 0) + (c.quantity ?? 0), unit: c.unit, cost: cell.cost + c.cost }
        : { quantity: c.quantity, unit: c.unit, cost: c.cost }
    }
    modalBatches.forEach((b, bi) => {
      b.dyes.forEach(c => add('dye', c, bi))
      b.auxiliary.forEach(c => add('aux', c, bi))
    })
    return [...rows.filter(r => r.kind === 'dye'), ...rows.filter(r => r.kind === 'aux')]
  }, [modalBatches])

  function openShadeModal(shade: string) {
    setShadeModal(shade)
    setCompareMode(false)
    setModalExpanded(new Set())
  }

  function toggleModalSlip(id: number) {
    setModalExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Δ/T across slips for one compare row: spread between cheapest and
  // costliest per-than cost of that chemical
  function rowDelta(cells: ({ cost: number } | null)[]): number {
    const perT = cells.map((c, i) => (c && modalBatches[i].than > 0 ? c.cost / modalBatches[i].than : 0))
    return Math.max(...perT) - Math.min(...perT)
  }

  function toggleFold(foldNo: string) {
    setExpandedFolds(prev => {
      const next = new Set(prev)
      if (next.has(foldNo)) next.delete(foldNo); else next.add(foldNo)
      return next
    })
  }

  function toggleBatch(key: string) {
    setExpandedBatches(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
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
                          <span className="text-[10px] text-gray-400">{f.slips} slips · {f.than}</span>
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
                            {f.batches.map((b, bi) => {
                              const bKey = `${f.foldNo}-${bi}`
                              const bOpen = expandedBatches.has(bKey)
                              return (
                                <div key={bi}>
                                  <button onClick={() => toggleBatch(bKey)} className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                                    <div className="text-left">
                                      <div className="flex items-center gap-2">
                                        <a href={`/dyeing/${b.id}`} target="_blank" onClick={e => e.stopPropagation()}
                                          className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline">
                                          Slip {b.slipNo}
                                        </a>
                                        {b.batchNo && <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">B{b.batchNo}</span>}
                                        <span className="text-[10px] text-gray-400">{new Date(b.date).toLocaleDateString('en-IN')}</span>
                                      </div>
                                      <p className="text-[10px] text-purple-500 dark:text-purple-400 flex items-center gap-1.5">{b.shade} <ShadeCategoryBadge category={b.colorCategory} /></p>
                                    </div>
                                    <div className="text-right flex items-center gap-2">
                                      <div>
                                        <p className="text-xs text-gray-600 dark:text-gray-300">{b.than} · {fmtINR(b.cost)}</p>
                                        <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{fmtINR(b.costPerThan)}/T</p>
                                      </div>
                                      <span className={`text-gray-400 text-[10px] transition-transform ${bOpen ? 'rotate-90' : ''}`}>▶</span>
                                    </div>
                                  </button>

                                  {bOpen && (
                                    <div className="px-4 pb-3 space-y-2">
                                      {/* Dye vs Aux cost bar */}
                                      <div className="flex gap-2 text-[10px]">
                                        <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded font-medium">Dyes: {fmtINR(b.dyeCost)}</span>
                                        <span className="bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded font-medium">Auxiliary: {fmtINR(b.auxCost)}</span>
                                      </div>

                                      {/* Dyes */}
                                      {b.dyes.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-bold text-purple-600 dark:text-purple-400 mb-1">Dyes</p>
                                          {b.dyes.map((c, ci) => (
                                            <div key={ci} className="flex items-center justify-between text-[10px] py-0.5">
                                              <span className="text-gray-700 dark:text-gray-300">{c.name}</span>
                                              <span className="text-gray-500">{c.quantity != null ? Number(c.quantity).toFixed(3) : '-'} {c.unit} · {fmtINR(c.cost)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {/* Auxiliary */}
                                      {b.auxiliary.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-bold text-teal-600 dark:text-teal-400 mb-1">Auxiliary</p>
                                          {b.auxiliary.map((c, ci) => (
                                            <div key={ci} className="flex items-center justify-between text-[10px] py-0.5">
                                              <span className="text-gray-700 dark:text-gray-300">{c.name}</span>
                                              <span className="text-gray-500">{c.quantity != null ? Number(c.quantity).toFixed(3) : '-'} {c.unit} · {fmtINR(c.cost)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                          <div className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fold Total</span>
                            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{f.than} · {fmtINR(f.cost)} · {fmtINR(f.avgPerThan)}/T</span>
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
                    <button
                      key={i}
                      onClick={() => openShadeModal(s.shade)}
                      className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-purple-50/60 dark:hover:bg-purple-900/10 transition text-left group"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{s.shade}</span>
                        <ShadeCategoryBadge category={s.colorCategory} />
                        <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium group-hover:bg-purple-200 dark:group-hover:bg-purple-800/60 transition">{s.count} slips ▸</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-gray-500">{s.than} · {fmtINR(s.cost)}</span>
                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 ml-2">{fmtINR(s.avgPerThan)}/T</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* Quality-wise */}
          {report.qualities?.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Quality-wise Cost</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {report.qualities.map((q, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{q.quality}</span>
                        <span className="text-[10px] text-gray-400 ml-2">{q.count} slips</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-gray-500">{q.than} · {fmtINR(q.cost)}</span>
                        <span className="text-xs font-bold text-teal-600 dark:text-teal-400 ml-2">{fmtINR(q.avgPerThan)}/T</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shade slip drill-down popup — bottom sheet on mobile, modal on desktop */}
      {shadeModal && modalShade && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6"
          onClick={e => { if (e.target === e.currentTarget) setShadeModal(null) }}
        >
          <div className={`bg-white dark:bg-gray-800 w-full ${compareMode ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col`}>
            {/* drag handle (mobile) */}
            <div className="pt-2 flex justify-center sm:hidden"><div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" /></div>

            {/* header */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{modalShade.shade}</span>
                  <ShadeCategoryBadge category={modalShade.colorCategory} />
                </div>
                <p className="text-[10px] text-gray-400">
                  {modalShade.count} slips · {modalShade.than} than · {fmtINR(modalShade.cost)} · avg {fmtINR(modalShade.avgPerThan)}/T
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {modalBatches.length >= 2 && (
                  <button
                    onClick={() => setCompareMode(!compareMode)}
                    className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition ${compareMode
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800/60'}`}
                  >
                    Compare
                  </button>
                )}
                <button
                  onClick={() => setShadeModal(null)}
                  className="w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* list view */}
            {!compareMode && (
              <div className="overflow-y-auto divide-y divide-gray-50 dark:divide-gray-700">
                {modalBatches.map(b => {
                  const open = modalExpanded.has(b.id)
                  const costly = modalBatches.length > 1 && b.costPerThan > modalShade.avgPerThan * 1.02
                  return (
                    <div key={b.id}>
                      <button
                        onClick={() => toggleModalSlip(b.id)}
                        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                      >
                        <div className="text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <a
                              href={`/dyeing/${b.id}`}
                              target="_blank"
                              onClick={e => e.stopPropagation()}
                              className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                            >
                              Slip {b.slipNo} ↗
                            </a>
                            <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                              Fold {b.foldNo}{b.batchNo ? ` · B${b.batchNo}` : ''}
                            </span>
                            <span className="text-[10px] text-gray-400">{new Date(b.date).toLocaleDateString('en-IN')}</span>
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-300">{b.than} · {fmtINR(b.cost)}</p>
                            <p className={`text-xs font-bold ${costly ? 'text-red-500' : 'text-indigo-600 dark:text-indigo-400'}`}>
                              {fmtINR(b.costPerThan)}/T{costly ? ' ▲' : ''}
                            </p>
                          </div>
                          <span className={`text-gray-400 text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                        </div>
                      </button>

                      {open && (
                        <div className="px-4 pb-3 space-y-2">
                          <div className="flex gap-2 text-[10px]">
                            <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded font-medium">Dyes: {fmtINR(b.dyeCost)}</span>
                            <span className="bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded font-medium">Auxiliary: {fmtINR(b.auxCost)}</span>
                          </div>
                          {b.dyes.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-purple-600 dark:text-purple-400 mb-1">Dyes</p>
                              {b.dyes.map((c, ci) => (
                                <div key={ci} className="flex items-center justify-between text-[10px] py-0.5">
                                  <span className="text-gray-700 dark:text-gray-300">{c.name}</span>
                                  <span className="text-gray-500">{c.quantity != null ? Number(c.quantity).toFixed(3) : '-'} {c.unit} · {fmtINR(c.cost)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {b.auxiliary.length > 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-teal-600 dark:text-teal-400 mb-1">Auxiliary</p>
                              {b.auxiliary.map((c, ci) => (
                                <div key={ci} className="flex items-center justify-between text-[10px] py-0.5">
                                  <span className="text-gray-700 dark:text-gray-300">{c.name}</span>
                                  <span className="text-gray-500">{c.quantity != null ? Number(c.quantity).toFixed(3) : '-'} {c.unit} · {fmtINR(c.cost)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <a href={`/dyeing/${b.id}`} target="_blank" className="inline-block text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:underline pt-1">
                            Open full slip →
                          </a>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* compare matrix view */}
            {compareMode && (
              <div className="overflow-auto p-4">
                <table className="w-full text-[11px] border-collapse" style={{ minWidth: 200 + modalBatches.length * 130 }}>
                  <thead>
                    <tr className="text-left text-gray-400">
                      <th className="py-1.5 pr-3 font-medium">Chemical</th>
                      {modalBatches.map(b => (
                        <th key={b.id} className="py-1.5 px-3 text-right font-medium">
                          <a href={`/dyeing/${b.id}`} target="_blank" className="text-purple-600 dark:text-purple-400 font-semibold hover:underline">
                            Slip {b.slipNo} ↗
                          </a>
                          <div className="text-[9px] font-normal">
                            Fold {b.foldNo} · {b.than}T · {new Date(b.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit' })}
                          </div>
                        </th>
                      ))}
                      <th className="py-1.5 pl-3 text-right font-medium">Δ/T</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {['dye', 'aux'].map(kind => {
                      const rows = compareRows.filter(r => r.kind === kind)
                      if (rows.length === 0) return null
                      return (
                        <Fragment key={kind}>
                          <tr className={kind === 'dye' ? 'bg-purple-50/40 dark:bg-purple-900/10' : 'bg-teal-50/40 dark:bg-teal-900/10'}>
                            <td colSpan={modalBatches.length + 2} className={`py-1 pr-3 text-[10px] font-bold ${kind === 'dye' ? 'text-purple-600 dark:text-purple-400' : 'text-teal-600 dark:text-teal-400'}`}>
                              {kind === 'dye' ? 'Dyes' : 'Auxiliary'}
                            </td>
                          </tr>
                          {rows.map(r => {
                            const delta = rowDelta(r.cells)
                            return (
                              <tr key={`${kind}-${r.name}`}>
                                <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.name}</td>
                                {r.cells.map((c, ci) => (
                                  <td key={ci} className="py-1.5 px-3 text-right text-gray-500 whitespace-nowrap">
                                    {c ? <>{c.quantity != null ? Number(c.quantity).toFixed(3) : '-'} {c.unit} · {fmtINR(Math.round(c.cost))}</> : <span className="text-gray-300 dark:text-gray-600">—</span>}
                                  </td>
                                ))}
                                <td className={`py-1.5 pl-3 text-right font-medium whitespace-nowrap ${delta >= 0.5 ? 'text-red-500' : 'text-gray-400'}`}>
                                  {delta >= 0.5 ? `+₹${delta.toFixed(1)}` : '≈'}
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 dark:border-gray-600">
                      <td className="py-2 pr-3 font-bold text-gray-700 dark:text-gray-200">Total</td>
                      {modalBatches.map(b => (
                        <td key={b.id} className="py-2 px-3 text-right font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap">
                          {fmtINR(b.cost)}
                          <div className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400">{fmtINR(b.costPerThan)}/T</div>
                        </td>
                      ))}
                      <td className="py-2 pl-3 text-right font-bold whitespace-nowrap">
                        {(() => {
                          const perT = modalBatches.map(b => b.costPerThan)
                          const d = Math.max(...perT) - Math.min(...perT)
                          return <span className={d >= 0.5 ? 'text-red-500' : 'text-gray-400'}>{d >= 0.5 ? `+₹${d.toFixed(1)}` : '≈'}</span>
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* footer */}
            <div className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-between rounded-b-none sm:rounded-b-2xl">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Shade Total</span>
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{modalShade.than} · {fmtINR(modalShade.cost)} · {fmtINR(modalShade.avgPerThan)}/T</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
