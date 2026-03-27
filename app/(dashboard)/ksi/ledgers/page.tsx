'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

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

type SortMode = 'name-asc' | 'name-desc' | 'parent-asc'
const PAGE_SIZE = 50
const FIRM = 'KSI'

function useDebounce<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function KSILedgerMasterPage() {
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [parentGroups, setParentGroups] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [parentFilter, setParentFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('name-asc')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [syncLog, setSyncLog] = useState<string[]>([])
  const [showSyncLog, setShowSyncLog] = useState(false)

  const observerRef = useRef<IntersectionObserver | null>(null)
  const lastItemRef = useCallback((node: HTMLDivElement | null) => {
    if (loadingMore) return
    if (observerRef.current) observerRef.current.disconnect()
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) loadMore()
    })
    if (node) observerRef.current.observe(node)
  }, [loadingMore, hasMore])

  useEffect(() => { setPage(1); loadLedgers(1, true) }, [debouncedSearch, parentFilter, sort])

  async function loadLedgers(p: number = 1, reset = false) {
    if (reset) setLoading(true)
    const params = new URLSearchParams({ firm: FIRM, sort, page: String(p), limit: String(PAGE_SIZE) })
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (parentFilter) params.set('parent', parentFilter)
    try {
      const res = await fetch(`/api/tally/ledgers?${params}`)
      const data = await res.json()
      const newLedgers = data.ledgers || []
      if (reset) setLedgers(newLedgers)
      else setLedgers(prev => [...prev, ...newLedgers])
      if (p === 1) setParentGroups(data.parentGroups || [])
      setTotal(data.total || 0)
      setHasMore(newLedgers.length === PAGE_SIZE)
    } catch { if (reset) setLedgers([]) }
    setLoading(false)
    setLoadingMore(false)
  }

  function loadMore() { const np = page + 1; setPage(np); setLoadingMore(true); loadLedgers(np, false) }

  async function handleSync() {
    setSyncing(true)
    setSyncLog(['▶ Syncing ledgers from Tally...'])
    setShowSyncLog(true)
    try {
      const res = await fetch(`/api/tally/sync-stream?firm=${FIRM}`)
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No stream')
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n'); buffer = lines.pop() || ''
        for (const line of lines) {
          const dataStr = line.replace(/^data: /, '').trim()
          if (!dataStr) continue
          try {
            const d = JSON.parse(dataStr)
            if (d.message) setSyncLog(prev => [...prev, d.message])
            if (d.type === 'complete') setSyncLog(prev => [...prev, `✓ Synced ${d.totalSaved} ledgers`])
          } catch {}
        }
      }
    } catch (e: any) { setSyncLog(prev => [...prev, `✗ Error: ${e.message}`]) }
    setSyncing(false)
    loadLedgers(1, true)
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/ksi/tally" className="text-gray-400 hover:text-gray-200 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Ledger Master</h1>
          <p className="text-xs text-gray-400">Kothari Synthetic Industries — {total} ledgers</p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition">
          {syncing ? <><span className="animate-spin">⟳</span> Syncing...</> : '🔄 Sync'}
        </button>
      </div>

      {/* Sync Log */}
      {showSyncLog && syncLog.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 mb-3 max-h-28 overflow-y-auto">
          {syncLog.map((l, i) => (
            <p key={i} className={`text-xs font-mono ${l.startsWith('✓') ? 'text-green-400' : l.startsWith('✗') ? 'text-red-400' : 'text-gray-400'}`}>{l}</p>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Search name, GST, PAN, mobile..." />
        <select value={parentFilter} onChange={e => setParentFilter(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-3 py-2 text-sm max-w-[180px]">
          <option value="">All Groups</option>
          {parentGroups.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortMode)}
          className="bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="name-asc">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
          <option value="parent-asc">Parent A-Z</option>
        </select>
      </div>

      <p className="text-xs text-gray-500 mb-3">Showing {ledgers.length} of {total}</p>

      {/* Ledger Cards */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl h-14 animate-pulse" />)}
        </div>
      ) : ledgers.length === 0 ? (
        <div className="py-16 text-center text-gray-500">
          <p className="text-4xl mb-3">📒</p>
          <p className="text-sm">{search || parentFilter ? 'No ledgers match your filters.' : 'No ledgers synced yet. Click "Sync" to import.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ledgers.map((ledger, idx) => {
            const expanded = expandedId === ledger.id
            const isLast = idx === ledgers.length - 1
            return (
              <div key={ledger.id} ref={isLast ? lastItemRef : undefined}
                className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                <div className="flex items-start">
                  <button onClick={() => setExpandedId(expanded ? null : ledger.id)}
                    className="flex-1 text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-700 transition">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-100 text-sm truncate">{ledger.name}</p>
                      {ledger.parent && <p className="text-xs text-gray-500 mt-0.5">{ledger.parent}</p>}
                      {!expanded && (ledger.gstNo || ledger.mobileNos) && (
                        <div className="flex flex-wrap gap-x-3 mt-1">
                          {ledger.gstNo && <span className="text-xs text-gray-500">GST: {ledger.gstNo}</span>}
                          {ledger.mobileNos && <span className="text-xs text-gray-500">{ledger.mobileNos}</span>}
                        </div>
                      )}
                    </div>
                    <svg className={`w-4 h-4 text-gray-500 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {/* Link to party detail */}
                  <Link href={`/ksi/party/${encodeURIComponent(ledger.name)}`}
                    className="px-3 py-3 text-gray-500 hover:text-indigo-400 transition shrink-0 self-center"
                    title="View party detail">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>

                {expanded && (
                  <div className="px-4 pb-4 border-t border-gray-700 pt-3 space-y-2">
                    {ledger.address && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">Address</p>
                        <p className="text-sm text-gray-200">{ledger.address}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {ledger.gstNo && (
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">GST No</p>
                          <p className="text-sm text-gray-200 font-mono">{ledger.gstNo}</p>
                        </div>
                      )}
                      {ledger.panNo && (
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">PAN No</p>
                          <p className="text-sm text-gray-200 font-mono">{ledger.panNo}</p>
                        </div>
                      )}
                      {ledger.mobileNos && (
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">Mobile</p>
                          <p className="text-sm text-gray-200">{ledger.mobileNos}</p>
                        </div>
                      )}
                      {ledger.state && (
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">State</p>
                          <p className="text-sm text-gray-200">{ledger.state}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {ledger.lastSynced && <p className="text-[10px] text-gray-600">Synced: {fmt(ledger.lastSynced)}</p>}
                      <Link href={`/ksi/party/${encodeURIComponent(ledger.name)}`}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
                        View Statement →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {loadingMore && <div className="py-4 text-center text-gray-500 text-sm">Loading more...</div>}
          {!hasMore && ledgers.length > 0 && <p className="py-4 text-center text-gray-600 text-xs">All {total} ledgers loaded</p>}
        </div>
      )}
    </div>
  )
}
