'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'

interface Lot {
  lotNo: string
  remaining: number
  party: string
  quality: string
  weight: string | null
  grayMtr: number | null
  date: string | null
  challanNos: string
  isOB: boolean
  originalThan: number
  deducted: { despatched: number; folded: number; obAllocated: number }
}

interface QualityGroup { quality: string; totalThan: number; lots: Lot[] }
interface PartyGroup { party: string; totalThan: number; totalLots: number; qualities: QualityGroup[] }

interface Response { parties: PartyGroup[]; grandTotal: number; totalLots: number; totalParties: number }

interface Props {
  open: boolean
  onClose: () => void
}

export default function UnallocatedStockModal({ open, onClose }: Props) {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedParties, setExpandedParties] = useState<Set<string>>(new Set())
  const [expandedQualities, setExpandedQualities] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/grey/unallocated-stock')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [open])

  const filtered = useMemo(() => {
    if (!data) return null
    const q = search.toLowerCase().trim()
    if (!q) return data
    const parties = data.parties.filter(p => {
      const partyMatch = p.party.toLowerCase().includes(q)
      const qualityMatch = p.qualities.some(ql => ql.quality.toLowerCase().includes(q))
      const lotMatch = p.qualities.some(ql => ql.lots.some(l => l.lotNo.toLowerCase().includes(q)))
      return partyMatch || qualityMatch || lotMatch
    })
    return { ...data, parties }
  }, [data, search])

  if (!open) return null

  const toggleParty = (p: string) => {
    setExpandedParties(prev => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p); else n.add(p)
      return n
    })
  }
  const toggleQuality = (k: string) => {
    setExpandedQualities(prev => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k); else n.add(k)
      return n
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">📊 Unallocated Grey Stock</h3>
            {filtered && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {filtered.grandTotal} than · {filtered.totalLots} lots · {filtered.totalParties} parties
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search party, quality, or lot..."
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-400 py-12">Loading...</div>
          ) : !filtered || filtered.parties.length === 0 ? (
            <div className="text-center text-gray-400 py-12">No unallocated grey stock</div>
          ) : (
            <div className="space-y-2">
              {filtered.parties.map(p => {
                const pOpen = expandedParties.has(p.party)
                return (
                  <div key={p.party} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleParty(p.party)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition"
                    >
                      <div className="text-left">
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{p.party}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{p.qualities.length} quality · {p.totalLots} lots</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{p.totalThan}T</span>
                        <span className={`text-gray-400 text-xs transition-transform ${pOpen ? 'rotate-90' : ''}`}>▶</span>
                      </div>
                    </button>

                    {pOpen && (
                      <div className="px-3 pb-3 pt-2 space-y-1.5 border-t border-gray-100 dark:border-gray-700">
                        {p.qualities.map(q => {
                          const qKey = `${p.party}::${q.quality}`
                          const qOpen = expandedQualities.has(qKey)
                          return (
                            <div key={qKey} className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                              <button
                                onClick={() => toggleQuality(qKey)}
                                className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                              >
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{q.quality}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{q.totalThan}T</span>
                                  <span className={`text-gray-400 text-[10px] transition-transform ${qOpen ? 'rotate-90' : ''}`}>▶</span>
                                </div>
                              </button>

                              {qOpen && (
                                <div className="px-2 pb-2 pt-1 space-y-1 border-t border-gray-50 dark:border-gray-700">
                                  {q.lots.map(l => (
                                    <Link
                                      key={l.lotNo}
                                      href={`/lot/${encodeURIComponent(l.lotNo)}`}
                                      className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 hover:border-teal-300 dark:hover:border-teal-700 hover:bg-teal-50/50 dark:hover:bg-teal-900/10 rounded-lg px-3 py-2 transition"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline">{l.lotNo}</span>
                                          {l.isOB && (
                                            <span className="text-[9px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-full">OB</span>
                                          )}
                                          {l.weight && (
                                            <span className="text-[9px] text-gray-500 dark:text-gray-400">{l.weight}</span>
                                          )}
                                        </div>
                                        {l.challanNos && (
                                          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Challan: {l.challanNos}</p>
                                        )}
                                        {(l.deducted.despatched > 0 || l.deducted.folded > 0 || l.deducted.obAllocated > 0) && (
                                          <p className="text-[9px] text-gray-400 mt-0.5">
                                            Of {l.originalThan}T: {l.deducted.despatched > 0 && `desp ${l.deducted.despatched}T · `}{l.deducted.folded > 0 && `folded ${l.deducted.folded}T · `}{l.deducted.obAllocated > 0 && `alloc ${l.deducted.obAllocated}T`}
                                          </p>
                                        )}
                                      </div>
                                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 ml-2">{l.remaining}T</span>
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
