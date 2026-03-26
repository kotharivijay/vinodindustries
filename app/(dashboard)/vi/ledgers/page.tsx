'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Ledger {
  id: number
  firmCode: string
  name: string
  parent: string | null
  address: string | null
  gstNo: string | null
  panNo: string | null
  mobileNos: string | null
  state: string | null
  lastSynced: string | null
}

const FIRM_TABS = ['ALL', 'VI', 'VCF', 'VF'] as const

const FIRM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  VI:  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  VCF: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200' },
  VF:  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
}

const FIRM_NAMES: Record<string, string> = {
  VI: 'Vinod Industries',
  VCF: 'Vimal Cotton Fabrics',
  VF: 'Vijay Fabrics',
}

type SortMode = 'name-asc' | 'name-desc' | 'parent-asc'

const PAGE_SIZE = 50

export default function LedgerMasterPage() {
  const router = useRouter()
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [parentGroups, setParentGroups] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const [firm, setFirm] = useState<string>('')
  const [search, setSearch] = useState('')
  const [parentFilter, setParentFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('name-asc')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)

  // Sync progress state (SSE-driven)
  interface SyncStep { firm: string; stage: string; message: string; progress?: number; total?: number }
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([])
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [overallProgress, setOverallProgress] = useState(0)
  const [syncElapsed, setSyncElapsed] = useState(0)

  // Virtual scroll: observe last item to load more
  const observerRef = useRef<IntersectionObserver | null>(null)
  const lastItemRef = useCallback((node: HTMLDivElement | null) => {
    if (loadingMore) return
    if (observerRef.current) observerRef.current.disconnect()
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMore()
      }
    })
    if (node) observerRef.current.observe(node)
  }, [loadingMore, hasMore])

  // Check Tally connection on mount
  useEffect(() => {
    fetch('/api/tally/config')
      .then(r => r.json())
      .then(d => setConnected(d.connected))
      .catch(() => setConnected(false))
  }, [])

  // Load ledgers when filters change (reset to page 1)
  useEffect(() => {
    setPage(1)
    loadLedgers(1, true)
  }, [firm, search, parentFilter, sort])

  async function loadLedgers(p: number = 1, reset: boolean = false) {
    if (reset) setLoading(true)
    const params = new URLSearchParams()
    if (firm) params.set('firm', firm)
    if (search) params.set('search', search)
    if (parentFilter) params.set('parent', parentFilter)
    params.set('sort', sort)
    params.set('page', String(p))
    params.set('limit', String(PAGE_SIZE))
    try {
      const res = await fetch(`/api/tally/ledgers?${params}`)
      const data = await res.json()
      const newLedgers = data.ledgers || []
      if (reset) {
        setLedgers(newLedgers)
      } else {
        setLedgers(prev => [...prev, ...newLedgers])
      }
      setParentGroups(data.parentGroups || [])
      setTotal(data.total || 0)
      setHasMore(newLedgers.length === PAGE_SIZE)
    } catch {
      if (reset) setLedgers([])
    }
    setLoading(false)
    setLoadingMore(false)
  }

  function loadMore() {
    const nextPage = page + 1
    setPage(nextPage)
    setLoadingMore(true)
    loadLedgers(nextPage, false)
  }

  // SSE-based sync — all processing happens on server
  async function handleSync() {
    const firmParam = firm || ''
    const firmsToSync = firmParam && FIRM_NAMES[firmParam] ? [firmParam] : ['VI', 'VCF', 'VF']

    setSyncing(true)
    setShowSyncModal(true)
    setSyncResult(null)
    setOverallProgress(0)
    setSyncElapsed(0)
    setSyncSteps(firmsToSync.map(f => ({ firm: f, stage: 'waiting', message: 'Waiting...' })))

    const startTime = Date.now()
    const timer = setInterval(() => setSyncElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000)

    try {
      const res = await fetch(`/api/tally/sync-stream?firm=${firmParam}`)
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No stream')

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const dataStr = line.replace(/^data: /, '').trim()
          if (!dataStr) continue
          try {
            const data = JSON.parse(dataStr)

            if (data.type === 'progress') {
              setSyncSteps(prev => prev.map(s =>
                s.firm === data.firm ? { ...s, stage: data.stage, message: data.message, progress: data.progress, total: data.total } : s
              ))

              // Calculate overall progress
              setSyncSteps(prev => {
                const done = prev.filter(s => s.stage === 'done' || s.stage === 'error').length
                const saving = prev.find(s => s.stage === 'saving')
                let pct = (done / firmsToSync.length) * 100
                if (saving?.total && saving?.progress) {
                  pct += (saving.progress / saving.total / firmsToSync.length) * 100
                }
                setOverallProgress(Math.min(Math.round(pct), 99))
                return prev
              })
            }

            if (data.type === 'complete') {
              setOverallProgress(100)
              setSyncResult(`Synced ${data.totalSaved} ledgers`)
            }
          } catch {}
        }
      }
    } catch {
      setSyncResult('Connection error')
    }

    clearInterval(timer)
    setSyncElapsed(Math.floor((Date.now() - startTime) / 1000))
    setOverallProgress(100)
    setSyncing(false)
    loadLedgers(1, true)
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">Ledger Master</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tally Prime ledgers across all firms</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className={`w-2 h-2 rounded-full ${connected === true ? 'bg-green-500' : connected === false ? 'bg-red-500' : 'bg-gray-300'}`} />
          {connected === true ? 'Connected' : connected === false ? 'Offline' : '...'}
        </span>
      </div>

      {/* Firm Tabs */}
      <div className="flex gap-1.5 mt-4 mb-3 overflow-x-auto pb-1">
        {FIRM_TABS.map(tab => {
          const active = tab === 'ALL' ? firm === '' : firm === tab
          return (
            <button
              key={tab}
              onClick={() => { setFirm(tab === 'ALL' ? '' : tab); setParentFilter('') }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab === 'ALL' ? 'All Firms' : tab}
            </button>
          )
        })}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Search name, GST, PAN, mobile..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 max-w-[200px]"
          value={parentFilter}
          onChange={e => setParentFilter(e.target.value)}
        >
          <option value="">All Groups</option>
          {parentGroups.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={sort}
          onChange={e => setSort(e.target.value as SortMode)}
        >
          <option value="name-asc">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
          <option value="parent-asc">Parent Ledger A-Z</option>
        </select>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
        >
          {syncing ? 'Syncing...' : 'Sync from Tally'}
        </button>
      </div>

      {/* Sync Progress Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800">{syncing ? 'Syncing from Tally...' : 'Sync Complete'}</h2>
                {!syncing && (
                  <button onClick={() => setShowSyncModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
                )}
              </div>

              {/* Overall progress bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>{overallProgress}%</span>
                  <span>{syncElapsed}s elapsed</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${overallProgress}%` }} />
                </div>
              </div>

              {/* Per-firm timeline */}
              <div className="space-y-3">
                {syncSteps.map(step => (
                  <div key={step.firm} className="flex gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {step.stage === 'done' && <span className="text-green-500 text-sm">&#10003;</span>}
                      {step.stage === 'error' && <span className="text-red-500 text-sm">&#10007;</span>}
                      {step.stage === 'waiting' && <span className="text-gray-300 text-sm">&#9711;</span>}
                      {['fetching', 'parsing', 'saving'].includes(step.stage) && (
                        <span className="text-indigo-500 text-sm animate-spin inline-block">&#10227;</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${(FIRM_COLORS[step.firm] || { bg: 'bg-gray-100', text: 'text-gray-600' }).bg} ${(FIRM_COLORS[step.firm] || { text: 'text-gray-600' }).text}`}>
                          {step.firm}
                        </span>
                        <span className="text-xs text-gray-500">{FIRM_NAMES[step.firm]}</span>
                      </div>
                      <p className={`text-xs mt-0.5 ${step.stage === 'error' ? 'text-red-500' : step.stage === 'done' ? 'text-green-600' : 'text-gray-500'}`}>
                        {step.message}
                      </p>
                      {step.stage === 'saving' && step.total && step.total > 0 && (
                        <div className="mt-1">
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div className="bg-indigo-400 h-1.5 rounded-full transition-all duration-200" style={{ width: `${Math.min(((step.progress || 0) / step.total) * 100, 100)}%` }} />
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">{step.progress || 0} of {step.total}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {!syncing && (
                <button onClick={() => setShowSyncModal(false)} className="mt-4 w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700">
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync Result Banner */}
      {syncResult && !showSyncModal && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-800 mb-3 flex items-center justify-between">
          <span>{syncResult}</span>
          <button onClick={() => setSyncResult(null)} className="text-blue-400 hover:text-blue-600 ml-2">&times;</button>
        </div>
      )}

      {/* Count */}
      <p className="text-xs text-gray-400 mb-3">
        Showing {ledgers.length} of {total} ledgers
        {firm && ` in ${FIRM_NAMES[firm] || firm}`}
      </p>

      {/* Ledger Cards with infinite scroll */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading ledgers...</div>
      ) : ledgers.length === 0 ? (
        <div className="py-12 text-center text-gray-400">
          {search || parentFilter ? 'No ledgers match your filters.' : 'No ledgers synced yet. Click "Sync from Tally" to import.'}
        </div>
      ) : (
        <div className="space-y-2">
          {ledgers.map((ledger, idx) => {
            const fc = FIRM_COLORS[ledger.firmCode] || { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' }
            const expanded = expandedId === ledger.id
            const isLast = idx === ledgers.length - 1
            return (
              <div
                key={ledger.id}
                ref={isLast ? lastItemRef : undefined}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(expanded ? null : ledger.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 text-sm">{ledger.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text} ${fc.border} border`}>
                        {ledger.firmCode}
                      </span>
                    </div>
                    {ledger.parent && <p className="text-xs text-gray-400 mt-0.5">{ledger.parent}</p>}
                    {!expanded && (ledger.gstNo || ledger.mobileNos) && (
                      <div className="flex flex-wrap gap-x-3 mt-1">
                        {ledger.gstNo && <span className="text-xs text-gray-500">GST: {ledger.gstNo}</span>}
                        {ledger.mobileNos && <span className="text-xs text-gray-500">{ledger.mobileNos}</span>}
                      </div>
                    )}
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-2">
                    {ledger.address && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Address</p>
                        <p className="text-sm text-gray-700">{ledger.address}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {ledger.gstNo && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">GST No</p>
                          <p className="text-sm text-gray-700 font-mono">{ledger.gstNo}</p>
                        </div>
                      )}
                      {ledger.panNo && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">PAN No</p>
                          <p className="text-sm text-gray-700 font-mono">{ledger.panNo}</p>
                        </div>
                      )}
                      {ledger.mobileNos && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Mobile</p>
                          <p className="text-sm text-gray-700">{ledger.mobileNos}</p>
                        </div>
                      )}
                      {ledger.state && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">State</p>
                          <p className="text-sm text-gray-700">{ledger.state}</p>
                        </div>
                      )}
                    </div>
                    {ledger.lastSynced && (
                      <p className="text-[10px] text-gray-300 mt-2">Last synced: {fmt(ledger.lastSynced)}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Loading more indicator */}
          {loadingMore && (
            <div className="py-4 text-center text-gray-400 text-sm">Loading more...</div>
          )}

          {!hasMore && ledgers.length > 0 && (
            <p className="py-4 text-center text-gray-300 text-xs">All {total} ledgers loaded</p>
          )}
        </div>
      )}
    </div>
  )
}
