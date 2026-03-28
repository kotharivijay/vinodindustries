'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import * as XLSX from 'xlsx'

function useDebounce<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Sale {
  id: number
  firmCode: string
  date: string | null
  vchNumber: string | null
  partyName: string | null
  itemName: string | null
  quantity: number | null
  unit: string | null
  rate: number | null
  amount: number
  vchType: string | null
  narration: string | null
}

const FIRM_TABS = ['ALL', 'VI', 'VCF', 'VF'] as const
const FIRM_COLORS: Record<string, { bg: string; text: string }> = {
  VI:  { bg: 'bg-blue-900/30', text: 'text-blue-400' },
  VCF: { bg: 'bg-teal-900/30', text: 'text-teal-400' },
  VF:  { bg: 'bg-orange-900/30', text: 'text-orange-400' },
}
const FIRM_NAMES: Record<string, string> = { VI: 'Vinod Industries', VCF: 'Vimal Cotton Fabrics', VF: 'Vijay Fabrics' }

const VCH_COLORS: Record<string, string> = {
  'Sales': 'text-green-400',
  'Credit Note': 'text-teal-400',
  'Purchase': 'text-blue-400',
  'Debit Note': 'text-orange-400',
  'Receipt': 'text-emerald-400',
  'Payment': 'text-rose-400',
}

type SortMode = 'date-desc' | 'date-asc' | 'amount-desc' | 'party-asc'
const PAGE_SIZE = 50

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d: string | null) {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}
function currentFY() {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { from: `${yr}-04-01`, to: `${yr + 1}-03-31` }
}

export default function SalesRegisterPage() {
  const fy = currentFY()
  const [sales, setSales] = useState<Sale[]>([])
  const [total, setTotal] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const [firm, setFirm] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [dateFrom, setDateFrom] = useState(fy.from)
  const [dateTo, setDateTo] = useState(fy.to)
  const [vchTypeFilter, setVchTypeFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('date-desc')

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncLog, setSyncLog] = useState<string[]>([])

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
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  useEffect(() => {
    if (swrData) {
      let s: Sale[] = swrData.sales || []
      if (vchTypeFilter) s = s.filter(x => x.vchType === vchTypeFilter)
      setSales(s)
      setTotal(swrData.total || 0)
      setTotalAmount(swrData.totalAmount || 0)
      setHasMore((swrData.sales || []).length === PAGE_SIZE)
      setPage(1)
    }
  }, [swrData, vchTypeFilter])

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
      let s: Sale[] = data.sales || []
      if (vchTypeFilter) s = s.filter(x => x.vchType === vchTypeFilter)
      setSales(prev => [...prev, ...s])
      setHasMore((data.sales || []).length === PAGE_SIZE)
    } catch {}
    setLoadingMore(false)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncLog(['\u25B6 Syncing sales from Tally...'])
    try {
      const res = await fetch(`/api/tally/sales-sync?firm=${firm}`)
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No stream')
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n').filter(l => l.startsWith('data:'))
        for (const line of lines) {
          try {
            const d = JSON.parse(line.replace('data:', '').trim())
            if (d.message) setSyncLog(prev => [...prev, d.message])
          } catch {}
        }
      }
      setSyncLog(prev => [...prev, '\u2713 Sync complete'])
    } catch (e: any) {
      setSyncLog(prev => [...prev, `\u2717 Error: ${e.message}`])
    }
    setSyncing(false)
    mutate()
  }

  function exportExcel() {
    const rows = sales.map(s => ({
      Date: s.date ? fmtDate(s.date) : '',
      Firm: s.firmCode,
      'Vch Type': s.vchType || '',
      'Vch No': s.vchNumber || '',
      Party: s.partyName || '',
      Item: s.itemName || '',
      Qty: s.quantity ?? '',
      Unit: s.unit || '',
      Rate: s.rate ?? '',
      Amount: s.amount,
      Narration: s.narration || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sales')
    XLSX.writeFile(wb, `VI_Sales_${dateFrom}_${dateTo}.xlsx`)
  }

  const vchTypes = ['Sales', 'Credit Note', 'Purchase', 'Debit Note', 'Receipt', 'Payment', 'Journal', 'Contra']

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/vi/tally" className="text-gray-400 hover:text-gray-200 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Sales Register</h1>
          <p className="text-xs text-gray-400">Vinod Industries Group — All vouchers</p>
        </div>
        <button onClick={exportExcel} disabled={sales.length === 0}
          className="bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-600 disabled:opacity-40 flex items-center gap-1.5">
          ⬇ Excel
        </button>
        <button onClick={handleSync} disabled={syncing}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
          {syncing ? <><span className="animate-spin">⟳</span> Syncing...</> : '🔄 Sync'}
        </button>
      </div>

      {syncLog.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 mb-3 max-h-28 overflow-y-auto">
          {syncLog.map((l, i) => (
            <p key={i} className={`text-xs font-mono ${l.startsWith('\u2713') ? 'text-green-400' : l.startsWith('\u2717') ? 'text-red-400' : 'text-gray-400'}`}>{l}</p>
          ))}
        </div>
      )}

      {/* Total Amount */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-gray-400 uppercase font-semibold">Total Amount</p>
          <p className="text-xl font-bold text-indigo-400">{formatINR(totalAmount)}</p>
        </div>
        <p className="text-xs text-gray-500">{total} vouchers</p>
      </div>

      {/* Firm Tabs */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {FIRM_TABS.map(tab => (
          <button key={tab} onClick={() => setFirm(tab === 'ALL' ? '' : tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${(tab === 'ALL' ? !firm : firm === tab) ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            {tab === 'ALL' ? 'All Firms' : tab}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <span className="text-gray-500 self-center text-xs">to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[140px] bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Search party / item..." />
        <select value={vchTypeFilter} onChange={e => setVchTypeFilter(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All Types</option>
          {vchTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortMode)}
          className="bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="date-desc">Date New→Old</option>
          <option value="date-asc">Date Old→New</option>
          <option value="amount-desc">Amount High</option>
          <option value="party-asc">Party A-Z</option>
        </select>
      </div>

      {/* Sales List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl h-14 animate-pulse" />)}
        </div>
      ) : sales.length === 0 ? (
        <div className="py-16 text-center text-gray-500">
          <p className="text-4xl mb-3">📈</p>
          <p className="text-sm">No sales data. Click &quot;Sync&quot; to pull from Tally.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sales.map((s, idx) => {
            const color = VCH_COLORS[s.vchType || ''] || 'text-gray-300'
            const fc = FIRM_COLORS[s.firmCode] || { bg: 'bg-gray-700', text: 'text-gray-300' }
            const isLast = idx === sales.length - 1
            return (
              <div key={s.id} ref={isLast ? lastRef : undefined}
                className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold ${color}`}>{s.vchType}</span>
                    <span className="text-xs text-gray-500">#{s.vchNumber}</span>
                    <span className="text-xs text-gray-500">{fmtDate(s.date)}</span>
                    <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{s.firmCode}</span>
                  </div>
                  {s.partyName ? (
                    <Link href={`/vi/party/${encodeURIComponent(s.partyName)}`}
                      className="text-sm font-medium text-gray-200 hover:text-indigo-400 truncate mt-0.5 block transition">
                      {s.partyName}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium text-gray-200 truncate mt-0.5">{s.narration || '\u2014'}</p>
                  )}
                  {s.itemName && <p className="text-[10px] text-gray-500 truncate">{s.itemName}{s.quantity ? ` · ${s.quantity} ${s.unit || ''}` : ''}</p>}
                </div>
                <p className={`text-sm font-bold shrink-0 ${color}`}>{formatINR(s.amount)}</p>
              </div>
            )
          })}
          {loadingMore && <div className="py-4 text-center text-gray-500 text-sm">Loading more...</div>}
          {!hasMore && sales.length > 0 && <p className="py-4 text-center text-gray-600 text-xs">All {total} vouchers loaded</p>}
        </div>
      )}
    </div>
  )
}
