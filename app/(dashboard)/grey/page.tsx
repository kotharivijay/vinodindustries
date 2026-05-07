'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import GreyImportModal from './GreyImportModal'
import UnallocatedStockModal from './UnallocatedStockModal'
import BackButton from '../BackButton'
import { LotLink, useLotBackHighlight, persistViewState, readViewState } from '@/lib/viewStatePersist'

const GREY_VIEW_KEY = 'grey-view-state'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface GreyEntry {
  id: number; sn: number | null; date: string; challanNo: number
  lotNo: string; than: number; bale: number | null; baleNo: string | null
  weight: string | null; grayMtr: number | null; transportLrNo: string | null
  lrNo: string | null; viverNameBill: string | null; echBaleThan: number | null
  party: { name: string }; quality: { name: string }
  transport: { name: string }; weaver: { name: string }
  stock: number; tDesp: number; openingBalance?: number
}

interface StockSummaryRow {
  lotNo: string; party: string; quality: string; weaver: string
  entries: number; greyThan: number; tDesp: number; stock: number; lastDate: string; openingBalance: number
}

type SortField = 'sn' | 'date' | 'party' | 'quality' | 'than' | 'lotNo' | 'lrNo' | 'tDesp' | 'stock'
type SortDir = 'asc' | 'desc'
type Tab = 'entries' | 'stock'
type StockFilter = 'all' | 'instock' | 'cleared'

function getValue(e: GreyEntry, field: SortField): string | number {
  switch (field) {
    case 'sn': return e.sn ?? 0
    case 'date': return new Date(e.date).getTime()
    case 'party': return e.party.name.toLowerCase()
    case 'quality': return e.quality.name.toLowerCase()
    case 'than': return e.than
    case 'lotNo': return e.lotNo.toLowerCase()
    case 'lrNo': return (e.lrNo ?? e.transportLrNo ?? '').toLowerCase()
    case 'tDesp': return e.tDesp
    case 'stock': return e.stock
  }
}

function useDebounce(value: string, delay = 200) {
  const [debounced, setDebounced] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(v), delay)
  }
  return [debounced, set] as const
}

export default function GreyListPage() {
  const router = useRouter()
  const { data: entries = [], isLoading: loading, mutate } = useSWR<GreyEntry[]>('/api/grey', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  type StageBreakdown = { fold: number; dye: number; finish: number; pack: number }
  const { data: stagesByLot = {} } = useSWR<Record<string, StageBreakdown>>('/api/grey/stages', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  // Restore filter/search state from sessionStorage so a back-nav from
  // /lot/[lotNo] keeps everything the operator typed. saveLotClick (in
  // LotLink) already records scrollY + lastClickedLot — we just append
  // the form state below.
  const initial = typeof window !== 'undefined' ? readViewState(GREY_VIEW_KEY) : {}
  // Sort prefs persist across browser sessions (sessionStorage clears on tab
  // close). localStorage is the source of truth on first mount; sessionStorage
  // (back-nav) wins when present so a quick lot drill-down → Back doesn't
  // forget mid-task overrides.
  const lsSort = typeof window !== 'undefined' ? (() => {
    try { return JSON.parse(localStorage.getItem('grey-sort-prefs') || '{}') } catch { return {} }
  })() : {}
  const [search, setSearchRaw] = useState<string>(() => initial.search ?? '')
  const [debouncedSearch, setDebouncedSearch] = useDebounce(initial.search ?? '')
  const [showImport, setShowImport] = useState(false)
  const [showUnallocated, setShowUnallocated] = useState(false)

  // Auto-reopen unallocated stock modal if user navigated away and came back.
  // App Router restores cached pages on router.back() without remounting, so a
  // mount-only useEffect misses the return trip. Re-check on every nav-back
  // signal (popstate, pageshow, visibilitychange).
  useEffect(() => {
    function check() {
      try {
        if (sessionStorage.getItem('unallocated-reopen') === '1') {
          sessionStorage.removeItem('unallocated-reopen')
          setShowUnallocated(true)
        }
      } catch {}
    }
    check()
    window.addEventListener('popstate', check)
    window.addEventListener('pageshow', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('popstate', check)
      window.removeEventListener('pageshow', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [sortField, setSortField] = useState<SortField>(() => initial.sortField ?? lsSort.sortField ?? 'date')
  const [sortDir, setSortDir] = useState<SortDir>(() => initial.sortDir ?? lsSort.sortDir ?? 'desc')
  const [tab, setTab] = useState<Tab>(() => initial.tab ?? 'entries')
  const [stockFilter, setStockFilter] = useState<StockFilter>(() => initial.stockFilter ?? 'all')
  const [stockPartySearch, setStockPartySearch] = useState<string>(() => initial.stockPartySearch ?? '')
  const [debouncedStockPartySearch, setDebouncedStockPartySearch] = useDebounce(initial.stockPartySearch ?? '')
  const [stockLotQSearch, setStockLotQSearch] = useState<string>(() => initial.stockLotQSearch ?? '')
  const [debouncedStockLotQSearch, setDebouncedStockLotQSearch] = useDebounce(initial.stockLotQSearch ?? '')
  type StockSortField = 'date' | 'lotNo' | 'party' | 'quality'
  type StockSortDir = 'asc' | 'desc'
  const [stockSortField, setStockSortField] = useState<StockSortField>(() => initial.stockSortField ?? lsSort.stockSortField ?? 'date')
  const [stockSortDir, setStockSortDir] = useState<StockSortDir>(() => initial.stockSortDir ?? lsSort.stockSortDir ?? 'desc')
  const [filters, setFilters] = useState<{ party: string; quality: string; lotNo: string; lrNo: string }>(
    () => initial.filters ?? { party: '', quality: '', lotNo: '', lrNo: '' }
  )
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [cfImporting, setCfImporting] = useState(false)
  const [cfResult, setCfResult] = useState<{ imported: number; totalThan: number } | null>(null)
  const toggleExpand = (id: number) => setExpandedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  // Persist filter/search state on every change so back-nav from /lot/[id]
  // restores the operator's view. The keys here mirror the useState
  // initialisers above; LotLink + saveLotClick handle scrollY + lastClickedLot.
  useEffect(() => {
    persistViewState(GREY_VIEW_KEY, {
      tab, sortField, sortDir, search,
      stockFilter, stockPartySearch, stockLotQSearch,
      stockSortField, stockSortDir,
      filters,
    })
  }, [tab, sortField, sortDir, search, stockFilter, stockPartySearch, stockLotQSearch, stockSortField, stockSortDir, filters])

  // Sort-only persistence to localStorage so the operator's last sort survives
  // closing the tab. Only the four sort fields go here; everything else stays
  // sessionStorage-scoped (search/filter/scroll are per-task, not per-user).
  useEffect(() => {
    try {
      localStorage.setItem('grey-sort-prefs', JSON.stringify({
        sortField, sortDir, stockSortField, stockSortDir,
      }))
    } catch {}
  }, [sortField, sortDir, stockSortField, stockSortDir])

  // Restore scroll + highlight the clicked lot card after returning from /lot/[id]
  useLotBackHighlight(GREY_VIEW_KEY, true)

  async function handleDelete(id: number) {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    setDeletingId(id)
    await fetch(`/api/grey/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    mutate()
  }

  async function handleCarryForwardImport() {
    if (!confirm('Import carry-forward opening balances from last year sheet? This will overwrite existing opening balances.')) return
    setCfImporting(true)
    setCfResult(null)
    try {
      const res = await fetch('/api/grey/carry-forward', { method: 'POST' })
      const data = await res.json()
      if (data.error) { alert('Import failed: ' + data.error); return }
      setCfResult({ imported: data.imported, totalThan: data.totalThan })
      mutate()
    } catch { alert('Import failed') }
    finally { setCfImporting(false) }
  }

  const stockSummary = useMemo<StockSummaryRow[]>(() => {
    const map = new Map<string, StockSummaryRow>()
    for (const e of entries) {
      const ob = e.openingBalance ?? 0
      const existing = map.get(e.lotNo)
      if (!existing) {
        map.set(e.lotNo, {
          lotNo: e.lotNo, party: e.party.name, quality: e.quality.name,
          weaver: e.weaver?.name ?? '', entries: 1, greyThan: e.than,
          tDesp: e.tDesp, stock: e.stock, lastDate: e.date, openingBalance: ob,
        })
      } else {
        existing.entries++
        existing.greyThan += e.than
        existing.tDesp = Math.max(existing.tDesp, e.tDesp)
        existing.openingBalance = Math.max(existing.openingBalance, ob)
        existing.stock = existing.openingBalance + existing.greyThan - existing.tDesp
        if (new Date(e.date) > new Date(existing.lastDate)) existing.lastDate = e.date
      }
    }
    return Array.from(map.values())
  }, [entries])

  const filteredStock = useMemo(() => {
    // Two separate boxes — each accepts whitespace-separated tokens (AND
    // within a box). Both boxes must match (AND across boxes).
    const partyTokens = debouncedStockPartySearch.toLowerCase().split(/\s+/).filter(Boolean)
    const lotQTokens = debouncedStockLotQSearch.toLowerCase().split(/\s+/).filter(Boolean)
    return stockSummary
      .filter(r => {
        const partyHay = (r.party || '').toLowerCase()
        const lotQHay = `${r.lotNo} ${r.quality} ${r.weaver || ''}`.toLowerCase()
        const matchParty = partyTokens.every(t => partyHay.includes(t))
        const matchLotQ = lotQTokens.every(t => lotQHay.includes(t))
        const matchFilter =
          stockFilter === 'all' ? true :
          stockFilter === 'instock' ? r.stock > 0 :
          r.stock === 0
        return matchParty && matchLotQ && matchFilter
      })
      .sort((a, b) => {
        const dir = stockSortDir === 'asc' ? 1 : -1
        switch (stockSortField) {
          case 'lotNo': return a.lotNo.localeCompare(b.lotNo) * dir
          case 'party': return (a.party || '').localeCompare(b.party || '') * dir
          case 'quality': return (a.quality || '').localeCompare(b.quality || '') * dir
          case 'date':
          default: {
            const ta = new Date(a.lastDate).getTime() || 0
            const tb = new Date(b.lastDate).getTime() || 0
            return (ta - tb) * dir
          }
        }
      })
  }, [stockSummary, debouncedStockPartySearch, debouncedStockLotQSearch, stockFilter, stockSortField, stockSortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const setFilter = (key: keyof typeof filters, val: string) =>
    setFilters(prev => ({ ...prev, [key]: val }))

  const filtered = useMemo(() =>
    entries
      .filter((e) => {
        const q = debouncedSearch.toLowerCase()
        const matchSearch = !q || (
          e.party.name.toLowerCase().includes(q) ||
          e.quality.name.toLowerCase().includes(q) ||
          e.lotNo.toLowerCase().includes(q) ||
          String(e.challanNo).includes(q) ||
          String(e.sn ?? '').includes(q)
        )
        const matchParty = !filters.party || e.party.name.toLowerCase().includes(filters.party.toLowerCase())
        const matchQuality = !filters.quality || e.quality.name.toLowerCase().includes(filters.quality.toLowerCase())
        const matchLot = !filters.lotNo || e.lotNo.toLowerCase().includes(filters.lotNo.toLowerCase())
        const matchLr = !filters.lrNo || (e.lrNo ?? e.transportLrNo ?? '').toLowerCase().includes(filters.lrNo.toLowerCase())
        return matchSearch && matchParty && matchQuality && matchLot && matchLr
      })
      .sort((a, b) => {
        const av = getValue(a, sortField)
        const bv = getValue(b, sortField)
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      }),
  [entries, debouncedSearch, filters, sortField, sortDir])

  function SortTh({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field
    return (
      <th onClick={() => toggleSort(field)} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600 group">
        <span className="flex items-center gap-1">
          {label}
          <span className={`transition ${active ? 'text-indigo-600' : 'text-gray-300 dark:text-gray-600 group-hover:text-gray-400'}`}>
            {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </span>
      </th>
    )
  }

  function PlainTh({ label }: { label: string }) {
    return <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide whitespace-nowrap">{label}</th>
  }

  const fi = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300 mt-1'
  const totalStock = useMemo(() => stockSummary.reduce((s, r) => s + r.stock, 0), [stockSummary])
  const lotsInStock = useMemo(() => stockSummary.filter(r => r.stock > 0).length, [stockSummary])

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Grey Inward</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{entries.length} entries · {stockSummary.length} lots · {lotsInStock} in stock</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCarryForwardImport}
            disabled={cfImporting}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {cfImporting ? 'Importing...' : 'Import Carry-Forward'}
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
            Import from Sheet
          </button>
          <button onClick={() => setShowUnallocated(true)} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700">
            📊 Unallocated Stock
          </button>
          <Link href="/grey/weights" className="flex items-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700">
            &#x2696;&#xFE0F; Update Weights
          </Link>
          <button
            onClick={async () => {
              const typed = prompt('Type RESET to delete all Grey + Despatch data. This cannot be undone.')
              if (typed !== 'RESET') return
              await fetch('/api/grey', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'RESET_GREY' }) })
              await fetch('/api/despatch', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'RESET_DESPATCH' }) })
              alert('All Grey + Despatch data deleted.')
              mutate()
            }}
            className="flex items-center gap-2 bg-red-100 text-red-700 border border-red-300 px-3 py-2 rounded-lg text-xs font-medium hover:bg-red-200"
          >
            Reset All
          </button>
          <Link href="/grey/new" className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            + New Entry
          </Link>
        </div>
      </div>

      {/* Carry-forward import result */}
      {cfResult && (
        <div className="mb-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            Carry-forward imported: <strong>{cfResult.imported} lots</strong>, <strong>{cfResult.totalThan.toLocaleString()} than</strong> total opening balance.
          </p>
          <button onClick={() => setCfResult(null)} className="text-blue-500 hover:text-blue-700 text-xs font-medium ml-4">Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setTab('entries')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === 'entries' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          All Entries
          <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded-full px-2 py-0.5">{entries.length}</span>
        </button>
        <button
          onClick={() => setTab('stock')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === 'stock' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          Stock Summary
          <span className="ml-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded-full px-2 py-0.5">{stockSummary.length} lots</span>
        </button>
      </div>

      {/* ── STOCK SUMMARY TAB ── */}
      {tab === 'stock' && (() => {
        const filteredHasQuery = !!(debouncedStockPartySearch || debouncedStockLotQSearch || stockFilter !== 'all')
        const filteredTotalThan = filteredStock.reduce((s, r) => s + r.stock, 0)
        return (
        <div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 mb-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {filteredHasQuery ? 'Filtered total (than)' : 'Total balance (than)'}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                {filteredStock.length} of {stockSummary.length} lot{stockSummary.length === 1 ? '' : 's'}
              </p>
            </div>
            <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
              {filteredTotalThan}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              type="text"
              placeholder="Party…"
              className="flex-1 min-w-[140px] max-w-xs border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={stockPartySearch}
              onChange={e => { setStockPartySearch(e.target.value); setDebouncedStockPartySearch(e.target.value) }}
            />
            <input
              type="text"
              placeholder="Lot no / Quality…"
              className="flex-1 min-w-[140px] max-w-xs border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={stockLotQSearch}
              onChange={e => { setStockLotQSearch(e.target.value); setDebouncedStockLotQSearch(e.target.value) }}
            />
            {(stockPartySearch || stockLotQSearch) && (
              <button
                onClick={() => {
                  setStockPartySearch(''); setDebouncedStockPartySearch('')
                  setStockLotQSearch(''); setDebouncedStockLotQSearch('')
                }}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500"
              >Clear</button>
            )}
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              {(['all', 'instock', 'cleared'] as StockFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setStockFilter(f)}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition ${stockFilter === f ? 'bg-white dark:bg-gray-600 shadow text-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                >
                  {f === 'all' ? 'All' : f === 'instock' ? 'In Stock' : 'Cleared'}
                </button>
              ))}
            </div>
          </div>

          {/* Sort row */}
          <div className="flex items-center flex-wrap gap-1.5 mb-4">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 mr-1">Sort:</span>
            {(['date', 'lotNo', 'party', 'quality'] as StockSortField[]).map(f => {
              const active = stockSortField === f
              const label = f === 'date' ? 'Date' : f === 'lotNo' ? 'Lot' : f === 'party' ? 'Party' : 'Quality'
              return (
                <button
                  key={f}
                  onClick={() => {
                    if (active) setStockSortDir(d => d === 'asc' ? 'desc' : 'asc')
                    else { setStockSortField(f); setStockSortDir(f === 'date' ? 'desc' : 'asc') }
                  }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {label}{active ? (stockSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              )
            })}
          </div>

          {loading ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-12 text-center text-gray-400 dark:text-gray-500">Loading...</div>
          ) : filteredStock.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-12 text-center text-gray-400 dark:text-gray-500">No lots found.</div>
          ) : (
            <>
              {/* Mobile card view */}
              <div className="sm:hidden space-y-2">
                {filteredStock.map(r => (
                  <div key={r.lotNo} data-lot-card={r.lotNo}
                    className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <LotLink lotNo={r.lotNo} storageKey={GREY_VIEW_KEY}
                            className="text-base font-semibold text-indigo-700 dark:text-indigo-400 hover:underline break-words">
                            {r.lotNo}
                          </LotLink>
                          {r.openingBalance > 0 && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-medium">OB</span>}
                        </div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 break-words">{r.party}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-300 break-words">{r.quality}</p>
                        {r.weaver && <p className="text-[11px] text-gray-500 dark:text-gray-400 break-words">{r.weaver}</p>}
                      </div>
                      <span className={`shrink-0 text-2xl font-bold leading-none ${r.stock > 0 ? 'text-green-600 dark:text-green-400' : r.stock < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                        {r.stock}
                      </span>
                    </div>
                    <StageChips lotNo={r.lotNo} greyThan={r.greyThan} tDesp={r.tDesp} stages={stagesByLot} />
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                      <span>{new Date(r.lastDate).toLocaleDateString('en-IN')} · {r.entries} entr{r.entries === 1 ? 'y' : 'ies'}</span>
                    </div>
                  </div>
                ))}
                {/* Totals row */}
                <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total ({filteredStock.length} lots)</span>
                    <span className="font-bold text-indigo-700 dark:text-indigo-400 text-base">{filteredStock.reduce((s, r) => s + r.stock, 0)}</span>
                  </div>
                  <div className="flex justify-end gap-3 text-gray-500 dark:text-gray-400">
                    <span>Grey <span className="font-bold text-gray-800 dark:text-gray-100">{filteredStock.reduce((s, r) => s + r.greyThan, 0)}</span></span>
                    <span>T_DESP <span className="font-bold text-orange-600 dark:text-orange-400">{filteredStock.reduce((s, r) => s + r.tDesp, 0)}</span></span>
                  </div>
                </div>
              </div>

              {/* Desktop table view */}
              <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Lot No</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Party</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Quality</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Weaver</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Last Date</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Entries</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Grey Than</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">T_DESP</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                      {filteredStock.map(r => (
                        <tr key={r.lotNo} data-lot-card={r.lotNo} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                          <td className="px-4 py-3 font-semibold text-indigo-700 dark:text-indigo-400">
                            <LotLink lotNo={r.lotNo} storageKey={GREY_VIEW_KEY} className="hover:underline">{r.lotNo}</LotLink>
                            {r.openingBalance > 0 && <span className="ml-1.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-medium">OB</span>}
                            <StageChips lotNo={r.lotNo} greyThan={r.greyThan} tDesp={r.tDesp} stages={stagesByLot} />
                          </td>
                          <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{r.party}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.quality}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{r.weaver}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{new Date(r.lastDate).toLocaleDateString('en-IN')}</td>
                          <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{r.entries}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-100">{r.greyThan}</td>
                          <td className="px-4 py-3 text-right text-orange-600 dark:text-orange-400 font-medium">{r.tDesp}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-bold text-base ${r.stock > 0 ? 'text-green-600 dark:text-green-400' : r.stock < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                              {r.stock}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 dark:bg-gray-700/50 border-t-2 border-gray-200 dark:border-gray-700">
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Total ({filteredStock.length} lots)</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-800 dark:text-gray-100">{filteredStock.reduce((s, r) => s + r.greyThan, 0)}</td>
                        <td className="px-4 py-3 text-right font-bold text-orange-600 dark:text-orange-400">{filteredStock.reduce((s, r) => s + r.tDesp, 0)}</td>
                        <td className="px-4 py-3 text-right font-bold text-indigo-700 dark:text-indigo-400">{filteredStock.reduce((s, r) => s + r.stock, 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
        )
      })()}

      {/* ── ALL ENTRIES TAB ── */}
      {tab === 'entries' && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <input
              type="text"
              placeholder="Search by party, quality, lot no, challan, SN..."
              className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={search}
              onChange={(e) => { setSearchRaw(e.target.value); setDebouncedSearch(e.target.value) }}
            />
            {(search || filters.party || filters.quality || filters.lotNo || filters.lrNo) && (
              <button onClick={() => { setSearchRaw(''); setDebouncedSearch(''); setFilters({ party: '', quality: '', lotNo: '', lrNo: '' }) }} className="text-xs text-gray-400 hover:text-red-500">
                Clear filters
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} of {entries.length}</span>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-gray-400">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                {entries.length === 0 ? 'No entries yet. Add manually or import from Google Sheet.' : 'No results found.'}
              </div>
            ) : (
              <>
                {/* ── Mobile card view ── */}
                <div className="block sm:hidden">
                  <div className="flex items-center gap-1.5 px-3 py-2 text-xs bg-gray-50 dark:bg-gray-700/40 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500 dark:text-gray-400">Sort:</span>
                    {([
                      { field: 'sn' as SortField, label: 'SN' },
                      { field: 'date' as SortField, label: 'Date' },
                      { field: 'lotNo' as SortField, label: 'Lot' },
                      { field: 'party' as SortField, label: 'Party' },
                    ]).map(({ field, label }) => (
                      <button
                        key={field}
                        onClick={() => toggleSort(field)}
                        className={`px-2 py-1 rounded font-medium transition ${sortField === field ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}
                      >
                        {label}{sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    ))}
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((e) => (
                    <div key={e.id} data-lot-card={e.lotNo} className="p-4 transition-shadow rounded-lg">
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                          <span className="text-gray-400 font-medium">SN {e.sn != null ? (e.sn < 0 ? `O${Math.abs(e.sn)}` : e.sn) : '—'}</span>
                          <span className="text-gray-300">·</span>
                          <span>{new Date(e.date).toLocaleDateString('en-IN')}</span>
                          <span className="text-gray-300">·</span>
                          <span>Ch {e.challanNo}</span>
                        </div>
                        <div className="flex gap-3 shrink-0">
                          <button onClick={() => router.push(`/grey/${e.id}/edit`)} className="text-indigo-500 text-xs font-medium">Edit</button>
                          <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-400 text-xs font-medium">{deletingId === e.id ? '...' : 'Del'}</button>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-gray-800">{e.party.name}</p>
                      <p className="text-xs text-gray-500 mb-2">{e.quality.name}</p>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <LotLink lotNo={e.lotNo} storageKey={GREY_VIEW_KEY} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-indigo-100 active:bg-indigo-200">
                          🔖 {e.lotNo}
                        </LotLink>
                        <span className="text-xs text-gray-600">Than: <strong>{e.than}</strong></span>
                        <span className={`text-xs font-semibold ${e.stock > 0 ? 'text-green-600' : e.stock < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                          Stock: {e.stock}
                        </span>
                      </div>
                      <button onClick={() => toggleExpand(e.id)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">
                        {expandedIds.has(e.id) ? '▲ Less' : '▼ More details'}
                      </button>
                      {expandedIds.has(e.id) && (
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                          <span>Weight: {e.weight ?? '—'}</span>
                          <span>Gray Mtr: {e.grayMtr ?? '—'}</span>
                          <span>Transport: {e.transport.name}</span>
                          <span>LR No: {e.lrNo ?? e.transportLrNo ?? '—'}</span>
                          <span>Bale: {e.bale ?? '—'}</span>
                          <span>Bale No: {e.baleNo ?? '—'}</span>
                          <span>Ech Bale: {e.echBaleThan ?? '—'}</span>
                          <span className="col-span-2">Weaver: {e.weaver?.name ?? '—'}</span>
                          <span>T_DESP: {e.tDesp}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  </div>
                </div>

                {/* ── Desktop table ── */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                      <tr>
                        <SortTh field="sn" label="SN" />
                        <SortTh field="date" label="Date" />
                        <PlainTh label="Challan" />
                        <th className="px-3 py-1 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600 group" onClick={() => toggleSort('party')}>
                          <span className="flex items-center gap-1">Party <span className={sortField==='party'?'text-indigo-600':'text-gray-300'}>{sortField==='party'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></span>
                          <input className={fi} placeholder="filter..." value={filters.party} onChange={e=>{e.stopPropagation();setFilter('party',e.target.value)}} onClick={e=>e.stopPropagation()} />
                        </th>
                        <th className="px-3 py-1 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort('quality')}>
                          <span className="flex items-center gap-1">Quality <span className={sortField==='quality'?'text-indigo-600':'text-gray-300'}>{sortField==='quality'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></span>
                          <input className={fi} placeholder="filter..." value={filters.quality} onChange={e=>{e.stopPropagation();setFilter('quality',e.target.value)}} onClick={e=>e.stopPropagation()} />
                        </th>
                        <PlainTh label="Weight" />
                        <SortTh field="than" label="Than" />
                        <PlainTh label="Gray Mtr" />
                        <th className="px-3 py-1 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort('lotNo')}>
                          <span className="flex items-center gap-1">Lot No <span className={sortField==='lotNo'?'text-indigo-600':'text-gray-300'}>{sortField==='lotNo'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></span>
                          <input className={fi} placeholder="filter..." value={filters.lotNo} onChange={e=>{e.stopPropagation();setFilter('lotNo',e.target.value)}} onClick={e=>e.stopPropagation()} />
                        </th>
                        <PlainTh label="Transport" />
                        <th className="px-3 py-1 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort('lrNo')}>
                          <span className="flex items-center gap-1">LR No <span className={sortField==='lrNo'?'text-indigo-600':'text-gray-300'}>{sortField==='lrNo'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></span>
                          <input className={fi} placeholder="filter..." value={filters.lrNo} onChange={e=>{e.stopPropagation();setFilter('lrNo',e.target.value)}} onClick={e=>e.stopPropagation()} />
                        </th>
                        <PlainTh label="Bale" />
                        <PlainTh label="Bale No" />
                        <PlainTh label="Ech Bale" />
                        <PlainTh label="Weaver" />
                        <SortTh field="tDesp" label="T_DESP" />
                        <SortTh field="stock" label="Stock" />
                        <PlainTh label="" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                      {filtered.map((e) => (
                        <tr key={e.id} data-lot-card={e.lotNo} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.sn != null ? (e.sn < 0 ? `O${Math.abs(e.sn)}` : e.sn) : '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap dark:text-gray-300">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                          <td className="px-3 py-2.5 dark:text-gray-300">{e.challanNo}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">{e.party.name}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap dark:text-gray-300">{e.quality.name}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.weight ?? '—'}</td>
                          <td className="px-3 py-2.5 font-semibold dark:text-gray-100">{e.than}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.grayMtr ?? '—'}</td>
                          <td className="px-3 py-2.5 font-medium text-indigo-700 dark:text-indigo-400">
                            <LotLink lotNo={e.lotNo} storageKey={GREY_VIEW_KEY} className="hover:underline">{e.lotNo}</LotLink>
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{e.transport.name}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.lrNo ?? e.transportLrNo ?? '—'}</td>
                          <td className="px-3 py-2.5 dark:text-gray-300">{e.bale ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.baleNo ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.echBaleThan ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{e.weaver?.name ?? '—'}</td>
                          <td className="px-3 py-2.5 text-orange-600 dark:text-orange-400 font-medium">{e.tDesp}</td>
                          <td className="px-3 py-2.5">
                            <span className={`font-semibold ${e.stock > 0 ? 'text-green-600' : e.stock < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                              {e.stock}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <button onClick={() => router.push(`/grey/${e.id}/edit`)} className="text-indigo-500 hover:text-indigo-700 text-xs font-medium mr-3">Edit</button>
                            <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-400 hover:text-red-600 text-xs font-medium disabled:opacity-40">
                              {deletingId === e.id ? '...' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {showImport && (
        <GreyImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); mutate() }}
        />
      )}

      <UnallocatedStockModal open={showUnallocated} onClose={() => {
        setShowUnallocated(false)
        try {
          sessionStorage.removeItem('unallocated-expanded-parties')
          sessionStorage.removeItem('unallocated-expanded-qualities')
          sessionStorage.removeItem('unallocated-search')
        } catch {}
      }} />
    </div>
  )
}

/**
 * Stage chips strip — shows where this lot's than currently sits across the
 * production pipeline. Each chip is colored per stage and only renders when
 * its than > 0, so cards stay compact for early-stage lots.
 */
function StageChips({ lotNo, greyThan, tDesp, stages }: {
  lotNo: string
  greyThan: number
  tDesp: number
  stages: Record<string, { fold: number; dye: number; finish: number; pack: number }>
}) {
  const s = stages[lotNo.toUpperCase()] || { fold: 0, dye: 0, finish: 0, pack: 0 }
  const all: { key: string; label: string; than: number; cls: string }[] = [
    { key: 'grey',   label: 'Grey',   than: greyThan, cls: 'bg-gray-100 dark:bg-gray-700/60 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600' },
    { key: 'fold',   label: 'Fold',   than: s.fold,   cls: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' },
    { key: 'dye',    label: 'Dye',    than: s.dye,    cls: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' },
    { key: 'finish', label: 'Finish', than: s.finish, cls: 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800' },
    { key: 'pack',   label: 'Pack',   than: s.pack,   cls: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
    { key: 'desp',   label: 'Desp',   than: tDesp,    cls: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' },
  ].filter(c => c.than > 0)
  if (all.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {all.map(c => (
        <span key={c.key} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${c.cls}`}>
          {c.label} <span className="font-bold">{c.than}</span>
        </span>
      ))}
    </div>
  )
}
