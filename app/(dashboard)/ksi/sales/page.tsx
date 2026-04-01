'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import * as XLSX from 'xlsx'

function useDebounce<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

interface Sale {
  id: number
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

const VCH_COLORS: Record<string, string> = {
  'Sales': 'text-green-400',
  'Credit Note': 'text-teal-400',
  'Purchase': 'text-blue-400',
  'Debit Note': 'text-orange-400',
  'Receipt': 'text-emerald-400',
  'Payment': 'text-rose-400',
}

const PAGE_SIZE = 50
const FIRM = 'KSI'

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function currentFY() {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { from: `${yr}-04-01`, to: `${yr + 1}-03-31` }
}

export default function KSISalesPage() {
  const router = useRouter()
  const fy = currentFY()
  const [sales, setSales] = useState<Sale[]>([])
  const [total, setTotal] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [dateFrom, setDateFrom] = useState(fy.from)
  const [dateTo, setDateTo] = useState(fy.to)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [vchTypeFilter, setVchTypeFilter] = useState('')
  const [sort, setSort] = useState('date-desc')

  const [syncing, setSyncing] = useState(false)
  const [syncLog, setSyncLog] = useState<string[]>([])

  const observerRef = useRef<IntersectionObserver | null>(null)
  const lastRef = useCallback((node: HTMLDivElement | null) => {
    if (loadingMore) return
    if (observerRef.current) observerRef.current.disconnect()
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) loadMore()
    })
    if (node) observerRef.current.observe(node)
  }, [loadingMore, hasMore])

  useEffect(() => { setPage(1); loadData(1, true) }, [dateFrom, dateTo, debouncedSearch, vchTypeFilter, sort])

  async function loadData(p: number = 1, reset = false) {
    if (reset) setLoading(true)
    const params = new URLSearchParams({ firm: FIRM, sort, page: String(p), limit: String(PAGE_SIZE) })
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (debouncedSearch) params.set('search', debouncedSearch)
    try {
      const res = await fetch(`/api/tally/sales?${params}`)
      const data = await res.json()
      let s: Sale[] = data.sales || []
      if (vchTypeFilter) s = s.filter((x: Sale) => x.vchType === vchTypeFilter)
      if (reset) setSales(s)
      else setSales(prev => [...prev, ...s])
      setTotal(data.total || 0)
      setTotalAmount(data.totalAmount || 0)
      setHasMore((data.sales || []).length === PAGE_SIZE)
    } catch { if (reset) setSales([]) }
    setLoading(false)
    setLoadingMore(false)
  }

  function loadMore() { const np = page + 1; setPage(np); setLoadingMore(true); loadData(np, false) }

  async function handleSync() {
    setSyncing(true)
    setSyncLog(['▶ Syncing sales from Tally...'])
    try {
      const res = await fetch(`/api/tally/sales-sync?firm=${FIRM}`)
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
      setSyncLog(prev => [...prev, '✓ Sync complete'])
    } catch (e: any) {
      setSyncLog(prev => [...prev, `✗ Error: ${e.message}`])
    }
    setSyncing(false)
    loadData(1, true)
  }

  function exportExcel() {
    const rows = sales.map(s => ({
      Date: s.date ? fmtDate(s.date) : '',
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
    XLSX.writeFile(wb, `KSI_Sales_${dateFrom}_${dateTo}.xlsx`)
  }

  const vchTypes = ['Sales', 'Credit Note', 'Purchase', 'Debit Note', 'Receipt', 'Payment', 'Journal', 'Contra']

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-200 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Sales Register</h1>
          <p className="text-xs text-gray-400">Kothari Synthetic Industries — All vouchers</p>
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
            <p key={i} className={`text-xs font-mono ${l.startsWith('✓') ? 'text-green-400' : l.startsWith('✗') ? 'text-red-400' : 'text-gray-400'}`}>{l}</p>
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
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="date-desc">Date New→Old</option>
          <option value="date-asc">Date Old→New</option>
          <option value="amount-desc">Amount High</option>
          <option value="party-asc">Party A-Z</option>
        </select>
      </div>

      {/* Sales Table */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl h-14 animate-pulse" />)}
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
            const isLast = idx === sales.length - 1
            return (
              <div key={s.id} ref={isLast ? lastRef : undefined}
                className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold ${color}`}>{s.vchType}</span>
                    <span className="text-xs text-gray-500">#{s.vchNumber}</span>
                    <span className="text-xs text-gray-500">{fmtDate(s.date)}</span>
                  </div>
                  {s.partyName ? (
                    <Link href={`/ksi/party/${encodeURIComponent(s.partyName)}`}
                      className="text-sm font-medium text-gray-200 hover:text-indigo-400 truncate mt-0.5 block transition">
                      {s.partyName}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium text-gray-200 truncate mt-0.5">{s.narration || '—'}</p>
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
