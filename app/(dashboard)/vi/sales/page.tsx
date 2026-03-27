'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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

interface SaleEntry {
  id: number
  firmCode: string
  date: string | null
  vchNumber: string | null
  partyName: string | null
  itemName: string | null
  quantity: number | null
  unit: string | null
  rate: number | null
  amount: number | null
  vchType: string | null
  narration: string | null
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

type SortMode = 'date-desc' | 'date-asc' | 'amount-desc' | 'party-asc'

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(d: string | null) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

const PAGE_SIZE = 50

export default function SalesRegisterPage() {
  const router = useRouter()
  const [sales, setSales] = useState<SaleEntry[]>([])
  const [total, setTotal] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const [firm, setFirm] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useDebounce()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sort, setSort] = useState<SortMode>('date-desc')

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
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    params.set('sort', sort)
    params.set('page', '1')
    params.set('limit', String(PAGE_SIZE))
    return `/api/tally/sales?${params}`
  }, [firm, debouncedSearch, dateFrom, dateTo, sort])

  const { data: swrData, isLoading: loading, mutate } = useSWR(swrKey, fetcher, {
    dedupingInterval: 5000,
    revalidateOnFocus: false,
  })

  // Update local state from SWR
  useEffect(() => {
    if (swrData) {
      setSales(swrData.sales || [])
      setTotal(swrData.total || 0)
      setTotalAmount(swrData.totalAmount || 0)
      setHasMore((swrData.sales || []).length === PAGE_SIZE)
      setPage(1)
    }
  }, [swrData])

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
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    params.set('sort', sort)
    params.set('page', String(np))
    params.set('limit', String(PAGE_SIZE))
    try {
      const res = await fetch(`/api/tally/sales?${params}`)
      const data = await res.json()
      setSales(prev => [...prev, ...(data.sales || [])])
      setHasMore((data.sales || []).length === PAGE_SIZE)
    } catch {}
    setLoadingMore(false)
  }

  // SSE sync
  async function handleSync(full = false) {
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
      const res = await fetch(`/api/tally/sales-sync?firm=${firm}${full ? '&full=1' : ''}`)
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
              setSyncResult(`Synced ${data.totalSaved} sales entries`)
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
          <h1 className="text-2xl font-bold text-gray-800">Sales Register</h1>
          <p className="text-sm text-gray-500">Sales vouchers from Tally Prime</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mt-4 mb-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-[10px] text-green-600 uppercase font-semibold">Total Sales</p>
          <p className="text-xl font-bold text-green-700">{formatINR(totalAmount)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-[10px] text-blue-600 uppercase font-semibold">Total Entries</p>
          <p className="text-xl font-bold text-blue-700">{total}</p>
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

      {/* Date Range */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">From</label>
          <input type="date" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">To</label>
          <input type="date" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
      </div>

      {/* Search + Sort + Sync */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input type="text" className="flex-1 min-w-[150px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Search party, item, voucher..." value={search} onChange={e => handleSearch(e.target.value)} />
        <select className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" value={sort} onChange={e => setSort(e.target.value as SortMode)}>
          <option value="date-desc">Date New→Old</option>
          <option value="date-asc">Date Old→New</option>
          <option value="amount-desc">Amount High→Low</option>
          <option value="party-asc">Party A-Z</option>
        </select>
        <button onClick={() => handleSync(false)} disabled={syncing}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
          {syncing ? 'Syncing...' : 'Sync'}
        </button>
        <button onClick={() => handleSync(true)} disabled={syncing}
          className="bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 whitespace-nowrap">
          Full Sync
        </button>
      </div>

      {/* Sync Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">{syncing ? 'Syncing Sales...' : 'Sync Complete'}</h2>
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
        Showing {sales.length} of {total} entries
        {firm && ` in ${FIRM_NAMES[firm] || firm}`}
      </p>

      {/* Cards */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading sales...</div>
      ) : sales.length === 0 ? (
        <div className="py-12 text-center text-gray-400">
          {search || dateFrom || dateTo ? 'No sales match your filters.' : 'No sales data synced yet. Click "Sync from Tally" to import.'}
        </div>
      ) : (
        <div className="space-y-2">
          {sales.map((s, idx) => {
            const fc = FIRM_COLORS[s.firmCode] || { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' }
            const isLast = idx === sales.length - 1
            return (
              <div key={s.id} ref={isLast ? lastRef : undefined} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {s.partyName && (
                        <Link
                          href={`/vi/party/${encodeURIComponent(s.partyName)}`}
                          className="font-semibold text-gray-800 text-sm hover:text-indigo-600 hover:underline transition"
                        >
                          {s.partyName}
                        </Link>
                      )}
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text} ${fc.border} border`}>
                        {s.firmCode}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 mt-1">
                      <span className="text-xs text-gray-500">{fmtDate(s.date)}</span>
                      {s.vchNumber && <span className="text-xs text-gray-400">#{s.vchNumber}</span>}
                      {s.vchType && s.vchType !== 'Sales' && <span className="text-xs text-amber-600">{s.vchType}</span>}
                    </div>
                    {s.itemName && (
                      <p className="text-xs text-gray-600 mt-1">{s.itemName}
                        {s.quantity != null && <span className="text-gray-400"> | {s.quantity}{s.unit ? ` ${s.unit}` : ''}</span>}
                        {s.rate != null && <span className="text-gray-400"> @ {s.rate}</span>}
                      </p>
                    )}
                    {s.narration && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{s.narration}</p>
                    )}
                  </div>
                  <p className="text-sm font-bold text-green-600 flex-shrink-0">
                    {s.amount != null ? formatINR(s.amount) : '--'}
                  </p>
                </div>
              </div>
            )
          })}

          {loadingMore && <div className="py-4 text-center text-gray-400 text-sm">Loading more...</div>}
          {!hasMore && sales.length > 0 && <p className="py-4 text-center text-gray-300 text-xs">All {total} entries loaded</p>}
        </div>
      )}
    </div>
  )
}
