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
                  <div className="border-t border-gray-700">
                    {/* Share bar with sort */}
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-gray-900/50 border-b border-gray-700">
                      <span className="text-[10px] text-gray-500">{partyBills.length} bills</span>
                      <select id={`sort-${g.partyName}`} defaultValue="due-old"
                        className="bg-gray-800 border border-gray-700 text-gray-300 rounded px-1.5 py-0.5 text-[10px]">
                        <option value="due-old">Due Old→New</option>
                        <option value="due-new">Due New→Old</option>
                        <option value="invoice">Invoice A→Z</option>
                        <option value="amount">Amount High→Low</option>
                      </select>
                      <div className="flex gap-1.5 ml-auto">
                        <button onClick={() => { const s = (document.getElementById(`sort-${g.partyName}`) as HTMLSelectElement)?.value || 'due-old'; sharePartyImage(g.partyName, partyBills, s) }} className="bg-green-700 text-white px-2.5 py-1 rounded-full text-[10px] font-bold hover:bg-green-600">📸 Image</button>
                        <button onClick={() => { const s = (document.getElementById(`sort-${g.partyName}`) as HTMLSelectElement)?.value || 'due-old'; sharePartyText(g.partyName, sortBills(partyBills, s)) }} className="bg-gray-700 text-gray-300 px-2.5 py-1 rounded-full text-[10px] font-bold hover:bg-gray-600">💬 Text</button>
                      </div>
                    </div>
                    <div className="px-4 pb-3 pt-2 space-y-2">
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

  // Sort bills
  function sortBills(b: Bill[], sortKey: string): Bill[] {
    const arr = [...b]
    if (sortKey === 'due-new') arr.sort((a, b) => (a.overdueDays || 0) - (b.overdueDays || 0))
    else if (sortKey === 'due-old') arr.sort((a, b) => (b.overdueDays || 0) - (a.overdueDays || 0))
    else if (sortKey === 'invoice') arr.sort((a, b) => (a.billRef || '').localeCompare(b.billRef || ''))
    else if (sortKey === 'amount') arr.sort((a, b) => Math.abs(b.closingBalance) - Math.abs(a.closingBalance))
    return arr
  }

  const BILLS_PER_PAGE = 15

  // Render one page of bills to canvas → return blob
  function renderBillPage(partyName: string, bills: Bill[], pageNum: number, totalPages: number, grandTotal: number): Blob {
    const today = new Date().toLocaleDateString('en-IN')
    const pageTotal = bills.reduce((s, b) => s + Math.abs(b.closingBalance), 0)
    const W = 360, rowH = 26, headerH = 75, footerH = 55, padY = 10
    const H = headerH + (bills.length * rowH) + footerH + padY * 2

    const canvas = document.createElement('canvas')
    canvas.width = W * 2; canvas.height = H * 2
    const ctx = canvas.getContext('2d')!
    ctx.scale(2, 2)

    // Background
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H)

    // Header
    ctx.fillStyle = '#16213e'; ctx.fillRect(0, 0, W, headerH)
    ctx.fillStyle = '#e65100'; ctx.fillRect(0, headerH - 3, W, 3)
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px Arial'
    ctx.fillText('📋 Outstanding Bills', 12, 20)
    ctx.fillStyle = '#a0a0c0'; ctx.font = '11px Arial'
    ctx.fillText(partyName.slice(0, 35), 12, 38)
    ctx.fillText('As on: ' + today, 12, 53)
    if (totalPages > 1) { ctx.fillStyle = '#7c7caa'; ctx.font = 'bold 10px Arial'; ctx.fillText(`Page ${pageNum} of ${totalPages}`, 12, 66) }
    ctx.fillStyle = '#e65100'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'right'
    ctx.fillText('₹' + grandTotal.toLocaleString('en-IN'), W - 12, 20)
    ctx.fillStyle = '#a0a0c0'; ctx.font = '10px Arial'
    ctx.fillText(bills.length + ' bills (this page)', W - 12, 38)
    ctx.textAlign = 'left'

    // Column headers
    const y0 = headerH + padY
    ctx.fillStyle = '#a0a0c0'; ctx.font = 'bold 9px Arial'
    ctx.fillText('#', 12, y0); ctx.fillText('BILL NO', 28, y0); ctx.fillText('DATE', 145, y0)
    ctx.textAlign = 'right'; ctx.fillText('AMOUNT', W - 55, y0); ctx.fillText('AGE', W - 12, y0); ctx.textAlign = 'left'

    // Rows
    bills.forEach((b, i) => {
      const y = y0 + 14 + i * rowH
      if (i % 2 === 0) { ctx.fillStyle = '#1a1a3e'; ctx.fillRect(0, y - 10, W, rowH) }
      ctx.fillStyle = '#808090'; ctx.font = '9px Arial'
      ctx.fillText(String((pageNum - 1) * BILLS_PER_PAGE + i + 1), 12, y + 4)
      ctx.fillStyle = '#ffffff'; ctx.font = '10px Arial'
      ctx.fillText((b.billRef || '-').slice(0, 18), 28, y + 4)
      ctx.fillStyle = '#c0c0d0'; ctx.fillText(b.billDate ? fmtDate(b.billDate) : '-', 145, y + 4)
      ctx.fillStyle = '#e65100'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'right'
      ctx.fillText('₹' + Math.abs(Math.round(b.closingBalance)).toLocaleString('en-IN'), W - 55, y + 4)
      const d = b.overdueDays || 0
      ctx.fillStyle = d >= 90 ? '#ef4444' : d >= 45 ? '#f97316' : d >= 15 ? '#eab308' : '#22c55e'
      ctx.font = 'bold 9px Arial'; ctx.fillText(d + 'd', W - 12, y + 4); ctx.textAlign = 'left'
    })

    // Footer
    const fy = y0 + 14 + bills.length * rowH + 4
    ctx.fillStyle = '#16213e'; ctx.fillRect(0, fy - 6, W, footerH)
    ctx.fillStyle = '#e65100'; ctx.fillRect(0, fy - 6, W, 2)
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px Arial'
    ctx.fillText('Page Total', 12, fy + 12)
    ctx.textAlign = 'right'; ctx.fillText('₹' + pageTotal.toLocaleString('en-IN'), W - 12, fy + 12); ctx.textAlign = 'left'
    if (totalPages > 1) {
      ctx.fillStyle = '#e65100'; ctx.font = 'bold 12px Arial'
      ctx.fillText('Grand Total', 12, fy + 30)
      ctx.textAlign = 'right'; ctx.fillText('₹' + grandTotal.toLocaleString('en-IN'), W - 12, fy + 30); ctx.textAlign = 'left'
    }
    ctx.fillStyle = '#a0a0c0'; ctx.font = '8px Arial'
    ctx.fillText('Please arrange payment at earliest.', 12, fy + 44)

    // Use toDataURL for synchronous conversion (preserves user gesture chain)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const byteStr = atob(dataUrl.split(',')[1])
    const ab = new ArrayBuffer(byteStr.length)
    const ia = new Uint8Array(ab)
    for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i)
    return new Blob([ab], { type: 'image/jpeg' })
  }

  // Fetch party mobile number
  async function getPartyMobile(partyName: string): Promise<string> {
    try {
      const res = await fetch(`/api/tally/party-detail?name=${encodeURIComponent(partyName)}`)
      const data = await res.json()
      return data.ledger?.mobileNo1 || data.contact?.mobile1 || ''
    } catch { return '' }
  }

  // Share party OS as multi-page JPG images (Option C: text first → then images)
  async function sharePartyImage(partyName: string, partyBills: Bill[], sortKey: string = 'due-old') {
    const sorted = sortBills(partyBills, sortKey)
    const grandTotal = sorted.reduce((s, b) => s + Math.abs(b.closingBalance), 0)
    const totalPages = Math.ceil(sorted.length / BILLS_PER_PAGE)
    const files: File[] = []

    for (let p = 0; p < totalPages; p++) {
      const pageBills = sorted.slice(p * BILLS_PER_PAGE, (p + 1) * BILLS_PER_PAGE)
      const blob = renderBillPage(partyName, pageBills, p + 1, totalPages, grandTotal)
      const suffix = totalPages > 1 ? `_p${p + 1}` : ''
      files.push(new File([blob], `os_${partyName.replace(/[^a-zA-Z0-9]/g, '_')}${suffix}.jpg`, { type: 'image/jpeg' }))
    }

    if (files.length === 0) return

    // Fetch mobile number
    const mobile = await getPartyMobile(partyName)
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10)

    // Step 1: Open WhatsApp chat with text message (pre-selects contact)
    if (cleanMobile.length === 10) {
      const today = new Date().toLocaleDateString('en-IN')
      const msg = `📋 Outstanding Bills - *${partyName}*\nAs on: ${today}\n*Total: ₹${grandTotal.toLocaleString('en-IN')}* (${sorted.length} bills)\n\n_See attached bill images below._`
      window.open(`https://wa.me/91${cleanMobile}?text=${encodeURIComponent(msg)}`, '_blank')
    }

    // Step 2: After short delay, share images (user is already in the chat)
    await new Promise(r => setTimeout(r, 1500))

    for (const file of files) {
      try {
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Outstanding - ' + partyName })
          continue
        }
      } catch {}
      // Fallback: download
      const url = URL.createObjectURL(file)
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
      URL.revokeObjectURL(url)
    }
  }

  // Share party OS as text — fetches mobile from API then opens WhatsApp
  async function sharePartyText(partyName: string, partyBills: Bill[]) {
    const today = new Date().toLocaleDateString('en-IN')
    const totalAmt = partyBills.reduce((s, b) => s + Math.abs(b.closingBalance), 0)
    const lines = partyBills.map((b, i) => `${i + 1}. ${b.billRef || '-'} | ${b.billDate ? fmtDate(b.billDate) : '-'} | ₹${Math.abs(Math.round(b.closingBalance)).toLocaleString('en-IN')} | ${b.overdueDays}d`)
    const msg = `📋 *Outstanding Bills*\n*${partyName}*\nAs on: ${today}\n${'─'.repeat(20)}\n${lines.join('\n')}\n${'─'.repeat(20)}\n*Total: ₹${totalAmt.toLocaleString('en-IN')}*\n\n_Please arrange payment at earliest._`

    // Fetch mobile number
    let mobile = ''
    try {
      const res = await fetch(`/api/tally/party-detail?name=${encodeURIComponent(partyName)}`)
      const data = await res.json()
      mobile = data.ledger?.mobileNo1 || data.contact?.mobile1 || ''
    } catch {}

    const waUrl = mobile
      ? `https://wa.me/91${mobile.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`
    window.open(waUrl, '_blank')
  }
}
