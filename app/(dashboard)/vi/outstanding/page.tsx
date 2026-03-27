'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function useDebounce(delay = 300) {
  const [debounced, setDebounced] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(v), delay)
  }
  return [debounced, set] as const
}

interface Bill {
  id: number
  firmCode: string
  partyName: string
  parent: string | null
  type: string
  billRef: string
  billDate: string | null
  dueDate: string | null
  overdueDays: number
  closingBalance: number
  vchType: string | null
  vchNumber: string | null
  vchAmount: number | null
}

interface PartyGroup {
  partyName: string
  firms: string[]
  totalReceivable: number
  totalPayable: number
  billCount: number
  maxOverdue: number
}

const FIRM_TABS = ['ALL', 'VI', 'VCF', 'VF'] as const
const TYPE_TABS = ['ALL', 'receivable', 'payable'] as const

const FIRM_COLORS: Record<string, { bg: string; text: string }> = {
  VI:  { bg: 'bg-blue-100', text: 'text-blue-700' },
  VCF: { bg: 'bg-teal-100', text: 'text-teal-700' },
  VF:  { bg: 'bg-orange-100', text: 'text-orange-700' },
}
const FIRM_NAMES: Record<string, string> = { VI: 'Vinod Industries', VCF: 'Vimal Cotton Fabrics', VF: 'Vijay Fabrics' }

type SortMode = 'amount-desc' | 'amount-asc' | 'name-asc' | 'overdue-desc' | 'parent-asc' | 'due-old' | 'due-new'

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

const PAGE_SIZE = 50

export default function OutstandingPage() {
  const router = useRouter()
  const [bills, setBills] = useState<Bill[]>([])
  const [total, setTotal] = useState(0)
  const [totalReceivable, setTotalReceivable] = useState(0)
  const [totalPayable, setTotalPayable] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [firm, setFirm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useDebounce()
  const [parentFilter, setParentFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('amount-desc')
  const [expandedParty, setExpandedParty] = useState<string | null>(null)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [showSyncModal, setShowSyncModal] = useState(false)
  interface SyncStep { firm: string; stage: string; message: string; progress?: number; total?: number }
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([])
  const [overallProgress, setOverallProgress] = useState(0)
  const [syncElapsed, setSyncElapsed] = useState(0)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  // Infinite scroll
  const observerRef = useRef<IntersectionObserver | null>(null)
  const lastRef = useCallback((node: HTMLDivElement | null) => {
    if (loadingMore) return
    if (observerRef.current) observerRef.current.disconnect()
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) loadMore()
    })
    if (node) observerRef.current.observe(node)
  }, [loadingMore, hasMore])

  // Build SWR key from filters
  const swrKey = useMemo(() => {
    const params = new URLSearchParams()
    if (firm) params.set('firm', firm)
    if (typeFilter) params.set('type', typeFilter)
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (parentFilter) params.set('parent', parentFilter)
    params.set('sort', sort)
    params.set('page', '1')
    params.set('limit', String(PAGE_SIZE))
    return `/api/tally/outstanding?${params}`
  }, [firm, typeFilter, debouncedSearch, parentFilter, sort])

  const { data: swrData, isLoading: loading, mutate } = useSWR(swrKey, fetcher, {
    dedupingInterval: 5000,
    revalidateOnFocus: false,
  })

  // Update local state from SWR
  useEffect(() => {
    if (swrData) {
      setBills(swrData.bills || [])
      setTotal(swrData.total || 0)
      setTotalReceivable(swrData.totalReceivable || 0)
      setTotalPayable(swrData.totalPayable || 0)
      setHasMore((swrData.bills || []).length === PAGE_SIZE)
      setPage(1)
    }
  }, [swrData])

  // Debounce search input
  function handleSearch(v: string) {
    setSearch(v)
    setDebouncedSearch(v)
  }

  async function loadMore() {
    const np = page + 1
    setPage(np)
    setLoadingMore(true)
    const params = new URLSearchParams()
    if (firm) params.set('firm', firm)
    if (typeFilter) params.set('type', typeFilter)
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (parentFilter) params.set('parent', parentFilter)
    params.set('sort', sort)
    params.set('page', String(np))
    params.set('limit', String(PAGE_SIZE))
    try {
      const res = await fetch(`/api/tally/outstanding?${params}`)
      const data = await res.json()
      setBills(prev => [...prev, ...(data.bills || [])])
      setHasMore((data.bills || []).length === PAGE_SIZE)
    } catch {}
    setLoadingMore(false)
  }

  // Get unique parent values from bills for filter dropdown
  const uniqueParents = useMemo(() => {
    const parents = new Set<string>()
    for (const b of bills) {
      if (b.parent) parents.add(b.parent)
    }
    return Array.from(parents).sort()
  }, [bills])

  // Group bills by party
  const partyGroups = useMemo(() => {
    const map = new Map<string, PartyGroup>()
    for (const b of bills) {
      let g = map.get(b.partyName)
      if (!g) {
        g = { partyName: b.partyName, firms: [], totalReceivable: 0, totalPayable: 0, billCount: 0, maxOverdue: 0 }
        map.set(b.partyName, g)
      }
      if (!g.firms.includes(b.firmCode)) g.firms.push(b.firmCode)
      if (b.type === 'receivable') g.totalReceivable += b.closingBalance
      else g.totalPayable += b.closingBalance
      g.billCount++
      if (b.overdueDays > g.maxOverdue) g.maxOverdue = b.overdueDays
    }
    let arr = Array.from(map.values())
    if (sort === 'name-asc') arr.sort((a, b) => a.partyName.localeCompare(b.partyName))
    else if (sort === 'amount-asc') arr.sort((a, b) => (a.totalReceivable + a.totalPayable) - (b.totalReceivable + b.totalPayable))
    else if (sort === 'overdue-desc') arr.sort((a, b) => b.maxOverdue - a.maxOverdue)
    else arr.sort((a, b) => (b.totalReceivable + b.totalPayable) - (a.totalReceivable + a.totalPayable))
    return arr
  }, [bills, sort])

  // SSE sync
  async function handleSync() {
    const firmsToSync = firm ? [firm] : ['VI', 'VCF', 'VF']
    setSyncing(true)
    setShowSyncModal(true)
    setSyncResult(null)
    setOverallProgress(0)
    setSyncElapsed(0)
    setSyncSteps(firmsToSync.map(f => ({ firm: f, stage: 'waiting', message: 'Waiting...' })))

    const startTime = Date.now()
    const timer = setInterval(() => setSyncElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000)

    try {
      const res = await fetch(`/api/tally/outstanding-sync?firm=${firm}`)
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
              setSyncSteps(prev => prev.map(s => s.firm === data.firm ? { ...s, stage: data.stage, message: data.message, progress: data.progress, total: data.total } : s))
              setSyncSteps(prev => {
                const d = prev.filter(s => s.stage === 'done' || s.stage === 'error').length
                const saving = prev.find(s => s.stage === 'saving')
                let pct = (d / firmsToSync.length) * 100
                if (saving?.total && saving?.progress) pct += (saving.progress / saving.total / firmsToSync.length) * 100
                setOverallProgress(Math.min(Math.round(pct), 99))
                return prev
              })
            }
            if (data.type === 'complete') {
              setOverallProgress(100)
              setSyncResult(`Synced ${data.totalSaved} bills`)
            }
          } catch {}
        }
      }
    } catch { setSyncResult('Connection error') }

    clearInterval(timer)
    setSyncElapsed(Math.floor((Date.now() - startTime) / 1000))
    setOverallProgress(100)
    setSyncing(false)
    mutate()
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">Outstanding</h1>
          <p className="text-sm text-gray-500">Bill-wise receivables &amp; payables</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mt-4 mb-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-[10px] text-green-600 uppercase font-semibold">Total Receivable</p>
          <p className="text-xl font-bold text-green-700">{formatINR(totalReceivable)}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-[10px] text-red-600 uppercase font-semibold">Total Payable</p>
          <p className="text-xl font-bold text-red-700">{formatINR(totalPayable)}</p>
        </div>
      </div>

      {/* Firm Tabs */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {FIRM_TABS.map(tab => (
          <button key={tab} onClick={() => setFirm(tab === 'ALL' ? '' : tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${(tab === 'ALL' ? !firm : firm === tab) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {tab === 'ALL' ? 'All Firms' : tab}
          </button>
        ))}
      </div>

      {/* Type + Search + Sort + Sync */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="flex gap-1">
          {TYPE_TABS.map(t => (
            <button key={t} onClick={() => setTypeFilter(t === 'ALL' ? '' : t)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${(t === 'ALL' ? !typeFilter : typeFilter === t) ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {t === 'ALL' ? 'All' : t === 'receivable' ? 'Receivable' : 'Payable'}
            </button>
          ))}
        </div>
        <input type="text" className="flex-1 min-w-[150px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Search party..." value={search} onChange={e => handleSearch(e.target.value)} />
        <select className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" value={parentFilter} onChange={e => setParentFilter(e.target.value)}>
          <option value="">All Groups</option>
          {uniqueParents.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" value={sort} onChange={e => setSort(e.target.value as SortMode)}>
          <option value="amount-desc">Amount High</option>
          <option value="amount-asc">Amount Low</option>
          <option value="overdue-desc">Most Overdue</option>
          <option value="name-asc">Name A-Z</option>
          <option value="parent-asc">Parent Ledger A-Z</option>
          <option value="due-old">Due Date Old→New</option>
          <option value="due-new">Due Date New→Old</option>
        </select>
        <button onClick={handleSync} disabled={syncing}
          className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
          {syncing ? 'Syncing...' : 'Sync from Tally'}
        </button>
      </div>

      {/* Sync Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">{syncing ? 'Syncing Outstanding...' : 'Sync Complete'}</h2>
              {!syncing && <button onClick={() => setShowSyncModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>}
            </div>
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1"><span>{overallProgress}%</span><span>{syncElapsed}s</span></div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${overallProgress}%` }} />
              </div>
            </div>
            <div className="space-y-3">
              {syncSteps.map(step => (
                <div key={step.firm} className="flex gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {step.stage === 'done' && <span className="text-green-500">&#10003;</span>}
                    {step.stage === 'error' && <span className="text-red-500">&#10007;</span>}
                    {step.stage === 'waiting' && <span className="text-gray-300">&#9711;</span>}
                    {['fetching', 'saving'].includes(step.stage) && <span className="text-indigo-500 animate-spin inline-block">&#10227;</span>}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${(FIRM_COLORS[step.firm] || { bg: 'bg-gray-100', text: 'text-gray-600' }).bg} ${(FIRM_COLORS[step.firm] || { text: 'text-gray-600' }).text}`}>{step.firm}</span>
                      <span className="text-xs text-gray-500">{FIRM_NAMES[step.firm]}</span>
                    </div>
                    <p className={`text-xs mt-0.5 ${step.stage === 'error' ? 'text-red-500' : step.stage === 'done' ? 'text-green-600' : 'text-gray-500'}`}>{step.message}</p>
                    {step.stage === 'saving' && step.total && step.total > 0 && (
                      <div className="mt-1">
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div className="bg-indigo-400 h-1.5 rounded-full transition-all" style={{ width: `${((step.progress || 0) / step.total) * 100}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">{step.progress} of {step.total}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!syncing && <button onClick={() => setShowSyncModal(false)} className="mt-4 w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700">Done</button>}
          </div>
        </div>
      )}

      {syncResult && !showSyncModal && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-800 mb-3 flex justify-between">
          <span>{syncResult}</span>
          <button onClick={() => setSyncResult(null)} className="text-blue-400 hover:text-blue-600">&times;</button>
        </div>
      )}

      {/* Count */}
      <p className="text-xs text-gray-400 mb-3">
        {partyGroups.length} parties, {total} bills
      </p>

      {/* Party Cards with expandable bills */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading...</div>
      ) : partyGroups.length === 0 ? (
        <div className="py-12 text-center text-gray-400">No outstanding data. Click &quot;Sync from Tally&quot; to import.</div>
      ) : (
        <div className="space-y-2">
          {partyGroups.map((g, idx) => {
            const expanded = expandedParty === g.partyName
            const partyBills = bills.filter(b => b.partyName === g.partyName)
            const isLast = idx === partyGroups.length - 1
            return (
              <div key={g.partyName} ref={isLast ? lastRef : undefined} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <button onClick={() => setExpandedParty(expanded ? null : g.partyName)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 text-sm">{g.partyName}</span>
                      {g.firms.map(f => (
                        <span key={f} className={`px-1 py-0.5 rounded text-[10px] font-bold ${(FIRM_COLORS[f] || { bg: 'bg-gray-100', text: 'text-gray-600' }).bg} ${(FIRM_COLORS[f] || { text: 'text-gray-600' }).text}`}>{f}</span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 mt-1">
                      {g.totalReceivable > 0 && <span className="text-xs font-medium text-green-600">{formatINR(g.totalReceivable)} receivable</span>}
                      {g.totalPayable > 0 && <span className="text-xs font-medium text-red-600">{formatINR(g.totalPayable)} payable</span>}
                      <span className="text-xs text-gray-400">{g.billCount} bills</span>
                      {g.maxOverdue > 0 && <span className={`text-xs font-medium ${g.maxOverdue > 90 ? 'text-red-500' : g.maxOverdue > 30 ? 'text-amber-500' : 'text-gray-500'}`}>{g.maxOverdue}d overdue</span>}
                    </div>
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {expanded && (
                  <div className="px-4 pb-3 border-t border-gray-100 pt-2">
                    <div className="space-y-2">
                      {partyBills.map(b => (
                        <div key={b.id} className={`rounded-lg p-3 border text-xs ${b.type === 'receivable' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-700">{b.billRef}</span>
                            <span className={`font-bold ${b.type === 'receivable' ? 'text-green-700' : 'text-red-700'}`}>{formatINR(b.closingBalance)}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 mt-1 text-gray-500">
                            <span>Date: {fmtDate(b.billDate)}</span>
                            <span>Due: {fmtDate(b.dueDate)}</span>
                            {b.overdueDays > 0 && <span className={`font-medium ${b.overdueDays > 90 ? 'text-red-500' : 'text-amber-500'}`}>{b.overdueDays}d overdue</span>}
                            {b.vchType && <span>{b.vchType}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {loadingMore && <div className="py-4 text-center text-gray-400 text-sm">Loading more...</div>}
          {!hasMore && bills.length > 0 && <p className="py-4 text-center text-gray-300 text-xs">All {total} bills loaded</p>}
        </div>
      )}
    </div>
  )
}
