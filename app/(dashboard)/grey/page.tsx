'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import GreyImportModal from './GreyImportModal'
import UnallocatedStockModal from './UnallocatedStockModal'
import BackButton from '../BackButton'

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
    case 'sn': return e.sn ?? e.id
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

  const [search, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useDebounce('')
  const [showImport, setShowImport] = useState(false)
  const [showUnallocated, setShowUnallocated] = useState(false)

  // Auto-reopen unallocated stock modal if user navigated away and came back
  useEffect(() => {
    try {
      if (sessionStorage.getItem('unallocated-reopen') === '1') {
        sessionStorage.removeItem('unallocated-reopen')
        setShowUnallocated(true)
      }
    } catch {}
  }, [])
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [tab, setTab] = useState<Tab>('entries')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [stockSearch, setStockSearch] = useState('')
  const [debouncedStockSearch, setDebouncedStockSearch] = useDebounce('')
  const [filters, setFilters] = useState({ party: '', quality: '', lotNo: '', lrNo: '' })
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [cfImporting, setCfImporting] = useState(false)
  const [cfResult, setCfResult] = useState<{ imported: number; totalThan: number } | null>(null)
  const toggleExpand = (id: number) => setExpandedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

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
          weaver: e.weaver.name, entries: 1, greyThan: e.than,
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

  const filteredStock = useMemo(() =>
    stockSummary
      .filter(r => {
        const q = debouncedStockSearch.toLowerCase()
        const matchSearch = !q || r.lotNo.toLowerCase().includes(q) || r.party.toLowerCase().includes(q) || r.quality.toLowerCase().includes(q)
        const matchFilter =
          stockFilter === 'all' ? true :
          stockFilter === 'instock' ? r.stock > 0 :
          r.stock === 0
        return matchSearch && matchFilter
      })
      .sort((a, b) => a.lotNo.localeCompare(b.lotNo)),
  [stockSummary, debouncedStockSearch, stockFilter])

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
      {tab === 'stock' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Lots</p>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">{stockSummary.length}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Lots with Stock</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{lotsInStock}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Balance (Than)</p>
              <p className="text-2xl font-bold text-indigo-600 mt-1">{totalStock}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="text"
              placeholder="Search lot no, party, quality..."
              className="w-full max-w-sm border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={stockSearch}
              onChange={e => { setStockSearch(e.target.value); setDebouncedStockSearch(e.target.value) }}
            />
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

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-gray-400">Loading...</div>
            ) : filteredStock.length === 0 ? (
              <div className="p-12 text-center text-gray-400">No lots found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
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
                      <tr key={r.lotNo} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                        <td className="px-4 py-3 font-semibold text-indigo-700 dark:text-indigo-400">
                          <Link href={`/lot/${encodeURIComponent(r.lotNo)}`} className="hover:underline">{r.lotNo}</Link>
                          {r.openingBalance > 0 && <span className="ml-1.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-medium">OB</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{r.party}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.quality}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{r.weaver}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{new Date(r.lastDate).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{r.entries}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-100">{r.greyThan}</td>
                        <td className="px-4 py-3 text-right text-orange-600 dark:text-orange-400 font-medium">{r.tDesp}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold text-base ${r.stock > 0 ? 'text-green-600' : r.stock < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                            {r.stock}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700 border-t-2 border-gray-200 dark:border-gray-600">
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Total ({filteredStock.length} lots)</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-800 dark:text-gray-100">{filteredStock.reduce((s, r) => s + r.greyThan, 0)}</td>
                      <td className="px-4 py-3 text-right font-bold text-orange-600">{filteredStock.reduce((s, r) => s + r.tDesp, 0)}</td>
                      <td className="px-4 py-3 text-right font-bold text-indigo-700 dark:text-indigo-400">{filteredStock.reduce((s, r) => s + r.stock, 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

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
                    <div key={e.id} className="p-4">
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                          <span className="text-gray-400 font-medium">SN {e.sn != null ? (e.sn < 0 ? `O${Math.abs(e.sn)}` : e.sn) : e.id}</span>
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
                        <Link href={`/lot/${encodeURIComponent(e.lotNo)}`} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-indigo-100 active:bg-indigo-200">
                          🔖 {e.lotNo}
                        </Link>
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
                          <span className="col-span-2">Weaver: {e.weaver.name}</span>
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
                        <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.sn != null ? (e.sn < 0 ? `O${Math.abs(e.sn)}` : e.sn) : e.id}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap dark:text-gray-300">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                          <td className="px-3 py-2.5 dark:text-gray-300">{e.challanNo}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-100 whitespace-nowrap">{e.party.name}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap dark:text-gray-300">{e.quality.name}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.weight ?? '—'}</td>
                          <td className="px-3 py-2.5 font-semibold dark:text-gray-100">{e.than}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.grayMtr ?? '—'}</td>
                          <td className="px-3 py-2.5 font-medium text-indigo-700 dark:text-indigo-400">
                            <Link href={`/lot/${encodeURIComponent(e.lotNo)}`} className="hover:underline">{e.lotNo}</Link>
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{e.transport.name}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.lrNo ?? e.transportLrNo ?? '—'}</td>
                          <td className="px-3 py-2.5 dark:text-gray-300">{e.bale ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.baleNo ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.echBaleThan ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{e.weaver.name}</td>
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
