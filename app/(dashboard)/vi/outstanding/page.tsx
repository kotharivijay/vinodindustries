'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
  VI:  { bg: 'bg-blue-900/30', text: 'text-blue-400' },
  VCF: { bg: 'bg-teal-900/30', text: 'text-teal-400' },
  VF:  { bg: 'bg-orange-900/30', text: 'text-orange-400' },
}
const FIRM_NAMES: Record<string, string> = { VI: 'Vinod Industries', VCF: 'Vimal Cotton Fabrics', VF: 'Vijay Fabrics' }

type SortMode = 'amount-desc' | 'amount-asc' | 'name-asc' | 'overdue-desc' | 'parent-asc' | 'due-old' | 'due-new'

const PAGE_SIZE = 50

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d: string | null) {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function OutstandingPage() {
  const searchParams = useSearchParams()
  const [bills, setBills] = useState<Bill[]>([])
  const [total, setTotal] = useState(0)
  const [totalReceivable, setTotalReceivable] = useState(0)
  const [totalPayable, setTotalPayable] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [firm, setFirm] = useState('')
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || '')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [parentFilter, setParentFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('amount-desc')
  const [expandedParty, setExpandedParty] = useState<string | null>(null)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

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
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

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

  const uniqueParents = useMemo(() => {
    const s = new Set<string>()
    for (const b of bills) { if (b.parent) s.add(b.parent) }
    return Array.from(s).sort()
  }, [bills])

  const partyGroups = useMemo(() => {
    const map = new Map<string, PartyGroup>()
    for (const b of bills) {
      let g = map.get(b.partyName)
      if (!g) { g = { partyName: b.partyName, firms: [], totalReceivable: 0, totalPayable: 0, billCount: 0, maxOverdue: 0 }; map.set(b.partyName, g) }
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

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('Syncing from Tally...')
    try {
      const firmParam = firm || ''
      const res = await fetch(`/api/tally/outstanding-sync?firm=${firmParam}`)
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
            if (d.message) setSyncMsg(d.message)
            if (d.type === 'complete') setSyncMsg(`\u2713 Synced ${d.totalSaved} bills`)
          } catch {}
        }
      }
    } catch (e: any) { setSyncMsg(`Error: ${e.message}`) }
    setSyncing(false)
    mutate()
  }

  function exportExcel() {
    const rows = bills.map(b => ({
      Party: b.partyName,
      Firm: b.firmCode,
      Group: b.parent || '',
      Type: b.type,
      'Bill Ref': b.billRef,
      'Bill Date': b.billDate ? fmtDate(b.billDate) : '',
      'Due Date': b.dueDate ? fmtDate(b.dueDate) : '',
      'Overdue Days': b.overdueDays,
      'Closing Balance': b.closingBalance,
      'Vch Type': b.vchType || '',
      'Vch No': b.vchNumber || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Outstanding')
    XLSX.writeFile(wb, `VI_Outstanding_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/vi/tally" className="text-gray-400 hover:text-gray-200 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Outstanding</h1>
          <p className="text-xs text-gray-400">Vinod Industries Group — Bill-wise receivables &amp; payables</p>
        </div>
        <button onClick={exportExcel} disabled={bills.length === 0}
          className="bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-600 disabled:opacity-40 flex items-center gap-1.5">
          ⬇ Excel
        </button>
        <button onClick={handleSync} disabled={syncing}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
          {syncing ? <><span className="animate-spin">⟳</span> Syncing...</> : '🔄 Sync'}
        </button>
      </div>

      {syncMsg && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 mb-3 flex justify-between">
          <span>{syncMsg}</span>
          <button onClick={() => setSyncMsg('')} className="text-gray-500 hover:text-gray-300">&times;</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-4">
          <p className="text-[10px] text-green-400 uppercase font-semibold mb-1">Total Receivable</p>
          <p className="text-xl font-bold text-green-400">{formatINR(totalReceivable)}</p>
        </div>
        <div className="bg-rose-900/20 border border-rose-800 rounded-xl p-4">
          <p className="text-[10px] text-rose-400 uppercase font-semibold mb-1">Total Payable</p>
          <p className="text-xl font-bold text-rose-400">{formatINR(totalPayable)}</p>
        </div>
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
        <div className="flex gap-1">
          {TYPE_TABS.map(t => (
            <button key={t} onClick={() => setTypeFilter(t === 'ALL' ? '' : t)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${(t === 'ALL' ? !typeFilter : typeFilter === t) ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
              {t === 'ALL' ? 'All' : t === 'receivable' ? 'Receivable' : 'Payable'}
            </button>
          ))}
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[150px] bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Search party..." />
        <select value={parentFilter} onChange={e => setParentFilter(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All Groups</option>
          {uniqueParents.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortMode)}
          className="bg-gray-700 border border-gray-600 text-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="amount-desc">Amount High</option>
          <option value="amount-asc">Amount Low</option>
          <option value="overdue-desc">Most Overdue</option>
          <option value="name-asc">Name A-Z</option>
          <option value="due-old">Due Date Old→New</option>
          <option value="due-new">Due Date New→Old</option>
        </select>
      </div>

      <p className="text-xs text-gray-500 mb-3">{partyGroups.length} parties, {total} bills</p>

      {/* Party Cards */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl h-16 animate-pulse" />)}
        </div>
      ) : partyGroups.length === 0 ? (
        <div className="py-16 text-center text-gray-500">
          <p className="text-4xl mb-3">💰</p>
          <p className="text-sm">No outstanding data. Click &quot;Sync&quot; to pull from Tally.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {partyGroups.map((g, idx) => {
            const expanded = expandedParty === g.partyName
            const partyBills = bills.filter(b => b.partyName === g.partyName)
            const isLast = idx === partyGroups.length - 1
            return (
              <div key={g.partyName} ref={isLast ? lastRef : undefined} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                <button onClick={() => setExpandedParty(expanded ? null : g.partyName)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-700 transition">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-100 text-sm truncate">{g.partyName}</p>
                      <Link href={`/vi/party/${encodeURIComponent(g.partyName)}`}
                        onClick={e => e.stopPropagation()}
                        className="text-gray-600 hover:text-indigo-400 transition shrink-0" title="View party detail">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      </Link>
                      {g.firms.map(f => {
                        const fc = FIRM_COLORS[f] || { bg: 'bg-gray-700', text: 'text-gray-300' }
                        return <span key={f} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{f}</span>
                      })}
                    </div>
                    <div className="flex flex-wrap gap-x-4 mt-0.5">
                      {g.totalReceivable > 0 && <span className="text-xs font-medium text-green-400">{formatINR(g.totalReceivable)} receivable</span>}
                      {g.totalPayable > 0 && <span className="text-xs font-medium text-rose-400">{formatINR(g.totalPayable)} payable</span>}
                      <span className="text-xs text-gray-500">{g.billCount} bills</span>
                      {g.maxOverdue > 0 && (
                        <span className={`text-xs font-medium ${g.maxOverdue > 90 ? 'text-red-400' : g.maxOverdue > 30 ? 'text-amber-400' : 'text-gray-500'}`}>
                          {g.maxOverdue}d overdue
                        </span>
                      )}
                    </div>
                  </div>
                  <svg className={`w-4 h-4 text-gray-500 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expanded && (
                  <div className="px-4 pb-3 border-t border-gray-700 pt-2 space-y-2">
                    {partyBills.map(b => {
                      const fc = FIRM_COLORS[b.firmCode] || { bg: 'bg-gray-700', text: 'text-gray-300' }
                      return (
                        <div key={b.id} className={`rounded-lg p-3 border text-xs ${b.type === 'receivable' ? 'bg-green-900/20 border-green-800' : 'bg-rose-900/20 border-rose-800'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{b.firmCode}</span>
                              <span className="font-semibold text-gray-200">{b.billRef}</span>
                            </div>
                            <span className={`font-bold ${b.type === 'receivable' ? 'text-green-400' : 'text-rose-400'}`}>{formatINR(b.closingBalance)}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 mt-1 text-gray-500">
                            <span>Date: {fmtDate(b.billDate)}</span>
                            <span>Due: {fmtDate(b.dueDate)}</span>
                            {b.overdueDays > 0 && <span className={`font-medium ${b.overdueDays > 90 ? 'text-red-400' : b.overdueDays > 30 ? 'text-amber-400' : 'text-gray-500'}`}>{b.overdueDays}d overdue</span>}
                            {b.vchType && <span>{b.vchType}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {loadingMore && <div className="py-4 text-center text-gray-500 text-sm">Loading more...</div>}
          {!hasMore && bills.length > 0 && <p className="py-4 text-center text-gray-600 text-xs">All {total} bills loaded</p>}
        </div>
      )}
    </div>
  )
}
