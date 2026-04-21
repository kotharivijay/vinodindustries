'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import DespatchImportModal from './DespatchImportModal'
import DespatchSyncModal from './DespatchSyncModal'
import NewSheetSyncModal from './NewSheetSyncModal'
import UpdateFromSheetModal from './UpdateFromSheetModal'
import BackButton from '../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function useDebounce(value: string, delay = 200) {
  const [debounced, setDebounced] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(v), delay)
  }
  return [debounced, set] as const
}

interface DespatchLot {
  id: number
  lotNo: string
  than: number
  meter: number | null
  rate: number | null
  amount: number | null
  description: string | null
  quality: { name: string } | null
}

interface DespatchEntry {
  id: number
  date: string
  challanNo: number
  lotNo: string
  grayInwDate: string | null
  jobDelivery: string | null
  than: number
  billNo: string | null
  rate: number | null
  pTotal: number | null
  lrNo: string | null
  bale: number | null
  party: { name: string }
  quality: { name: string }
  transport: { name: string } | null
  narration: string | null
  despatchLots?: DespatchLot[]
  isLastYear?: boolean
  financialYear?: string
}

interface StockSummaryRow {
  lotNo: string
  party: string
  quality: string
  entries: number
  totalThan: number
  totalPTotal: number
  lastDate: string
}

type SortField = 'id' | 'date' | 'challanNo' | 'party' | 'quality' | 'lotNo' | 'than' | 'rate' | 'pTotal' | 'lrNo'
type SortDir = 'asc' | 'desc'
type Tab = 'entries' | 'stock'

function getValue(e: DespatchEntry, field: SortField): string | number {
  switch (field) {
    case 'id': return e.id
    case 'date': return new Date(e.date).getTime()
    case 'challanNo': return e.challanNo
    case 'party': return e.party.name.toLowerCase()
    case 'quality': return e.quality.name.toLowerCase()
    case 'lotNo': return e.lotNo.toLowerCase()
    case 'than': return e.than
    case 'rate': return e.rate ?? 0
    case 'pTotal': return e.pTotal ?? 0
    case 'lrNo': return (e.lrNo ?? '').toLowerCase()
  }
}

export default function DespatchListPage() {
  const router = useRouter()
  const { data: entries = [], isLoading: loading, mutate } = useSWR<DespatchEntry[]>('/api/despatch', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  const [search, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useDebounce('')
  const [showImport, setShowImport] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const [showNewSheetSync, setShowNewSheetSync] = useState(false)
  const [showUpdateFromSheet, setShowUpdateFromSheet] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)

  async function handleReset() {
    setResetting(true)
    const res = await fetch('/api/despatch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESET_DESPATCH' }),
    })
    const data = await res.json()
    setResetting(false)
    setShowReset(false)
    setResetConfirmText('')
    if (res.ok) { alert(`✅ Deleted ${data.deleted} entries. You can now re-import.`); mutate() }
    else alert(data.error ?? 'Reset failed')
  }
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [sortField, setSortField] = useState<SortField>('id')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [tab, setTab] = useState<Tab>('entries')
  const [stockSearch, setStockSearch] = useState('')
  const [debouncedStockSearch, setDebouncedStockSearch] = useDebounce('')
  const [filters, setFilters] = useState({ party: '', quality: '', lotNo: '', lrNo: '' })
  const [hideOB, setHideOB] = useState(true)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('despatch-hide-ob')
      if (saved !== null) setHideOB(saved === 'true')
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('despatch-hide-ob', String(hideOB)) } catch {}
  }, [hideOB])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const toggleExpand = (id: number) => setExpandedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  async function handleDelete(id: number) {
    if (!confirm('Delete this despatch entry? This cannot be undone.')) return
    setDeletingId(id)
    await fetch(`/api/despatch/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    mutate()
  }

  const stockSummary = useMemo<StockSummaryRow[]>(() => {
    const map = new Map<string, StockSummaryRow>()
    const addToMap = (lotNo: string, party: string, quality: string, than: number, pTotal: number, date: string) => {
      const existing = map.get(lotNo)
      if (!existing) {
        map.set(lotNo, { lotNo, party, quality, entries: 1, totalThan: than, totalPTotal: pTotal, lastDate: date })
      } else {
        existing.entries++
        existing.totalThan += than
        existing.totalPTotal += pTotal
        if (new Date(date) > new Date(existing.lastDate)) existing.lastDate = date
      }
    }
    const src = hideOB ? entries.filter(e => !e.isLastYear) : entries
    for (const e of src) {
      if (e.despatchLots && e.despatchLots.length > 0) {
        for (const l of e.despatchLots) {
          addToMap(l.lotNo, e.party.name, l.quality?.name ?? e.quality.name, l.than, l.amount ?? 0, e.date)
        }
      } else {
        addToMap(e.lotNo, e.party.name, e.quality.name, e.than, e.pTotal ?? 0, e.date)
      }
    }
    return Array.from(map.values()).sort((a, b) => a.lotNo.localeCompare(b.lotNo))
  }, [entries, hideOB])

  const filteredStock = useMemo(() =>
    stockSummary.filter(r => {
      const q = debouncedStockSearch.toLowerCase()
      return !q || r.lotNo.toLowerCase().includes(q) || r.party.toLowerCase().includes(q) || r.quality.toLowerCase().includes(q)
    }),
  [stockSummary, debouncedStockSearch])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const setFilter = (key: keyof typeof filters, val: string) =>
    setFilters(prev => ({ ...prev, [key]: val }))

  function normLot(lot: string) {
    return lot.toLowerCase().trim().replace(/\s+/g, ' ')
  }

  const dupMap = useMemo(() => {
    const map = new Map<number, string>()
    const challanLotCount = new Map<string, number[]>()
    for (const e of entries) {
      const key = `${e.challanNo}__${normLot(e.lotNo)}`
      const arr = challanLotCount.get(key) ?? []
      arr.push(e.id)
      challanLotCount.set(key, arr)
    }
    for (const [, ids] of challanLotCount) {
      if (ids.length > 1) {
        for (const id of ids) map.set(id, 'Same Challan No + Lot No')
      }
    }
    return map
  }, [entries])

  const isDup = (e: DespatchEntry) => dupMap.has(e.id)
  const getDupReason = (e: DespatchEntry) => dupMap.get(e.id) ?? ''

  const obCount = useMemo(() => entries.filter(e => e.isLastYear).length, [entries])

  const filtered = useMemo(() =>
    entries
      .filter((e) => {
        if (hideOB && e.isLastYear) return false
        const q = debouncedSearch.toLowerCase()
        const matchSearch = !q || (
          e.party.name.toLowerCase().includes(q) ||
          e.quality.name.toLowerCase().includes(q) ||
          e.lotNo.toLowerCase().includes(q) ||
          String(e.challanNo).includes(q) ||
          (e.billNo ?? '').toLowerCase().includes(q)
        )
        const matchParty = !filters.party || e.party.name.toLowerCase().includes(filters.party.toLowerCase())
        const matchQuality = !filters.quality || e.quality.name.toLowerCase().includes(filters.quality.toLowerCase())
        const matchLot = !filters.lotNo || e.lotNo.toLowerCase().includes(filters.lotNo.toLowerCase())
        const matchLr = !filters.lrNo || (e.lrNo ?? '').toLowerCase().includes(filters.lrNo.toLowerCase())
        return matchSearch && matchParty && matchQuality && matchLot && matchLr
      })
      .sort((a, b) => {
        const av = getValue(a, sortField)
        const bv = getValue(b, sortField)
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      }),
  [entries, debouncedSearch, filters, sortField, sortDir, hideOB])

  function SortTh({ field, label, right }: { field: SortField; label: string; right?: boolean }) {
    const active = sortField === field
    return (
      <th
        onClick={() => toggleSort(field)}
        className={`px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600 group ${right ? 'text-right' : 'text-left'}`}
      >
        <span className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
          {label}
          <span className={`transition ${active ? 'text-indigo-600' : 'text-gray-300 group-hover:text-gray-400'}`}>
            {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </span>
      </th>
    )
  }

  function PlainTh({ label, right }: { label: string; right?: boolean }) {
    return <th className={`px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{label}</th>
  }

  const fi = 'w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300 mt-1'
  const totalThan = stockSummary.reduce((s, r) => s + r.totalThan, 0)
  const totalValue = stockSummary.reduce((s, r) => s + r.totalPTotal, 0)

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Despatch</h1>
            <p className="text-sm text-gray-500 mt-1">{entries.length} entries · {stockSummary.length} lots</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowNewSheetSync(true)}
            className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700"
          >
            🔄 Sync New Despatch
          </button>
          <button
            onClick={() => setShowUpdateFromSheet(true)}
            className="flex items-center gap-2 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700"
          >
            📝 Update from Sheet
          </button>
          <Link href="/despatch/new" className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            + New Entry
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        <button
          onClick={() => setTab('entries')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === 'entries' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          All Entries
          <span className="ml-2 bg-gray-100 text-gray-600 text-xs rounded-full px-2 py-0.5">{entries.length}</span>
        </button>
        <button
          onClick={() => setTab('stock')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === 'stock' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Lot Summary
          <span className="ml-2 bg-gray-100 text-gray-600 text-xs rounded-full px-2 py-0.5">{stockSummary.length} lots</span>
        </button>
      </div>

      {/* ── LOT SUMMARY TAB ── */}
      {tab === 'stock' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Lots</p>
              <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">{stockSummary.length}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Despatched (Than)</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">{totalThan}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Value (P.Total)</p>
              <p className="text-2xl font-bold text-indigo-600 mt-1">₹{totalValue.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</p>
            </div>
          </div>

          <div className="mb-4 flex items-center gap-3">
            <input
              type="text"
              placeholder="Search lot no, party, quality..."
              className="flex-1 max-w-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={stockSearch}
              onChange={e => { setStockSearch(e.target.value); setDebouncedStockSearch(e.target.value) }}
            />
            {obCount > 0 && (
              <button onClick={() => setHideOB(v => !v)}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium ${hideOB ? 'bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300' : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                {hideOB ? `Hide OB (${obCount})` : 'Show All'}
              </button>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-gray-400">Loading...</div>
            ) : filteredStock.length === 0 ? (
              <div className="p-12 text-center text-gray-400">No lots found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Lot No</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Party</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Quality</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Date</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Entries</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Than</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredStock.map(r => (
                      <tr key={r.lotNo} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                        <td className="px-4 py-3 font-semibold text-indigo-700">
                          <Link href={`/lot/${encodeURIComponent(r.lotNo)}`} className="hover:underline">{r.lotNo}</Link>
                        </td>
                        <td className="px-4 py-3 text-gray-800">{r.party}</td>
                        <td className="px-4 py-3 text-gray-600">{r.quality}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.lastDate).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{r.entries}</td>
                        <td className="px-4 py-3 text-right font-semibold text-orange-600">{r.totalThan}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-800">
                          {r.totalPTotal > 0 ? `₹${r.totalPTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700/50 border-t-2 border-gray-200 dark:border-gray-600">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total ({filteredStock.length} lots)</td>
                      <td className="px-4 py-3 text-right font-bold text-orange-600">{filteredStock.reduce((s, r) => s + r.totalThan, 0)}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-800">
                        ₹{filteredStock.reduce((s, r) => s + r.totalPTotal, 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
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
              placeholder="Search by party, quality, lot no, challan, bill no..."
              className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={search}
              onChange={(e) => { setSearchRaw(e.target.value); setDebouncedSearch(e.target.value) }}
            />
            {obCount > 0 && (
              <button onClick={() => setHideOB(v => !v)}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium ${hideOB ? 'bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300' : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                {hideOB ? `Hide OB (${obCount})` : 'Show All'}
              </button>
            )}
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
                <div className="block sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((e) => {
                    const lots = e.despatchLots && e.despatchLots.length > 0 ? e.despatchLots : null
                    return (
                    <div key={e.id} className={`p-4 ${isDup(e) ? 'bg-red-50 dark:bg-red-900/20' : ''}`}>
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <span>{new Date(e.date).toLocaleDateString('en-IN')}</span>
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                          <Link href={`/despatch/${e.id}`} className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">Ch {e.challanNo}</Link>
                          {isDup(e) && <span className="bg-red-100 text-red-600 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide" title={getDupReason(e)}>Dup: {getDupReason(e)}</span>}
                        </div>
                        <div className="flex gap-3 shrink-0">
                          <button onClick={() => router.push(`/despatch/${e.id}/edit`)} className="text-indigo-500 text-xs font-medium">Edit</button>
                          <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-400 text-xs font-medium">{deletingId === e.id ? '...' : 'Del'}</button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{e.party?.name ?? '-'}</p>
                        {e.isLastYear && <span className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded font-medium">Last Year</span>}
                      </div>
                      {lots ? (
                        <div className="mt-1.5 space-y-1">
                          {lots.map((l, li) => {
                            const lotQuality = l.quality?.name ?? e.quality?.name ?? null
                            return (
                            <div key={li} className="flex flex-wrap items-center gap-1.5 text-xs">
                              <Link href={`/lot/${encodeURIComponent(l.lotNo)}`} className="inline-flex items-center bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold px-2 py-0.5 rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/50">
                                {l.lotNo}
                              </Link>
                              <span className="text-gray-600 dark:text-gray-400">({l.than}T)</span>
                              {lotQuality && <span className="text-gray-700 dark:text-gray-300 font-medium">{lotQuality}</span>}
                              {l.description && <span className="text-gray-500 dark:text-gray-400 italic">{l.description}</span>}
                            </div>
                            )
                          })}
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Total: {lots.reduce((s, l) => s + l.than, 0)} than
                            {e.pTotal != null && e.pTotal > 0 && <span> · {e.pTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>}
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{e.quality?.name ?? '-'}</p>
                          {e.narration && <p className="text-xs text-gray-400 dark:text-gray-500 italic mb-1">{e.narration}</p>}
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <Link href={`/lot/${encodeURIComponent(e.lotNo)}`} className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-indigo-100">
                              {e.lotNo}
                            </Link>
                            <span className="text-xs text-gray-600 dark:text-gray-400">Than: <strong>{e.than}</strong></span>
                            {e.pTotal != null && (
                              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{e.pTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            )}
                          </div>
                        </>
                      )}
                      <button onClick={() => toggleExpand(e.id)} className="text-xs text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium mt-1">
                        {expandedIds.has(e.id) ? '- Less' : '+ More details'}
                      </button>
                      {expandedIds.has(e.id) && (
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                          <span>Gray Inw: {e.grayInwDate ? new Date(e.grayInwDate).toLocaleDateString('en-IN') : '—'}</span>
                          <span>Job: {e.jobDelivery || '—'}</span>
                          <span>Bill No: {e.billNo || '—'}</span>
                          <span>Rate: {e.rate ?? '—'}</span>
                          <span>LR No: {e.lrNo || '—'}</span>
                          <span>Transport: {e.transport?.name ?? '—'}</span>
                          <span>Bale: {e.bale ?? '—'}</span>
                        </div>
                      )}
                    </div>
                  )})}
                </div>

                {/* ── Desktop table ── */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
                      <tr>
                        <SortTh field="date" label="Date" />
                        <SortTh field="challanNo" label="Challan" />
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort('party')}>
                          <span className="flex items-center gap-1">Party <span className={sortField==='party'?'text-indigo-600':'text-gray-300'}>{sortField==='party'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></span>
                          <input className={fi} placeholder="filter..." value={filters.party} onChange={e=>{e.stopPropagation();setFilter('party',e.target.value)}} onClick={e=>e.stopPropagation()} />
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort('quality')}>
                          <span className="flex items-center gap-1">Quality <span className={sortField==='quality'?'text-indigo-600':'text-gray-300'}>{sortField==='quality'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></span>
                          <input className={fi} placeholder="filter..." value={filters.quality} onChange={e=>{e.stopPropagation();setFilter('quality',e.target.value)}} onClick={e=>e.stopPropagation()} />
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort('lotNo')}>
                          <span className="flex items-center gap-1">Lot No <span className={sortField==='lotNo'?'text-indigo-600':'text-gray-300'}>{sortField==='lotNo'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></span>
                          <input className={fi} placeholder="filter..." value={filters.lotNo} onChange={e=>{e.stopPropagation();setFilter('lotNo',e.target.value)}} onClick={e=>e.stopPropagation()} />
                        </th>
                        <PlainTh label="Gray Inw" />
                        <PlainTh label="Job Delivery" />
                        <SortTh field="than" label="Than" right />
                        <PlainTh label="Bill No" />
                        <SortTh field="rate" label="Rate" right />
                        <SortTh field="pTotal" label="P.Total" right />
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600" onClick={() => toggleSort('lrNo')}>
                          <span className="flex items-center gap-1">LR No <span className={sortField==='lrNo'?'text-indigo-600':'text-gray-300'}>{sortField==='lrNo'?(sortDir==='asc'?'↑':'↓'):'↕'}</span></span>
                          <input className={fi} placeholder="filter..." value={filters.lrNo} onChange={e=>{e.stopPropagation();setFilter('lrNo',e.target.value)}} onClick={e=>e.stopPropagation()} />
                        </th>
                        <PlainTh label="Transport" />
                        <PlainTh label="Bale" right />
                        <PlainTh label="" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                      {filtered.map((e) => {
                        const lots = e.despatchLots && e.despatchLots.length > 0 ? e.despatchLots : null
                        return (
                        <tr key={e.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition ${isDup(e) ? 'bg-red-50 dark:bg-red-900/20' : ''}`}>
                          <td className="px-3 py-2.5 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                          <td className="px-3 py-2.5">
                            <Link href={`/despatch/${e.id}`} className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">{e.challanNo}</Link>
                            {isDup(e) && <span className="ml-1.5 bg-red-100 text-red-600 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide" title={getDupReason(e)}>Dup</span>}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                            {e.party?.name ?? '-'}
                            {e.isLastYear && <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1 py-0.5 rounded">LY</span>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{e.quality?.name ?? '-'}</td>
                          <td className="px-3 py-2.5">
                            {lots ? (
                              <div className="space-y-0.5">
                                {lots.map((l, li) => {
                                  const lotQuality = l.quality?.name ?? e.quality?.name ?? null
                                  return (
                                  <div key={li} className="flex items-center gap-1.5 text-xs">
                                    <Link href={`/lot/${encodeURIComponent(l.lotNo)}`} className="font-medium text-indigo-700 dark:text-indigo-400 hover:underline">{l.lotNo}</Link>
                                    <span className="text-gray-500 dark:text-gray-400">({l.than}T)</span>
                                    {lotQuality && <span className="text-gray-600 dark:text-gray-300">{lotQuality}</span>}
                                    {l.description && <span className="text-gray-400 dark:text-gray-500 italic">{l.description}</span>}
                                  </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <Link href={`/lot/${encodeURIComponent(e.lotNo)}`} className="font-medium text-indigo-700 dark:text-indigo-400 hover:underline">{e.lotNo}</Link>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                            {e.grayInwDate ? new Date(e.grayInwDate).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 text-xs">{e.jobDelivery || '—'}</td>
                          <td className="px-3 py-2.5 text-right font-semibold">{e.than}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.billNo || '—'}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600 dark:text-gray-400">{e.rate ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-gray-800 dark:text-gray-200">
                            {e.pTotal != null ? `${e.pTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{e.lrNo || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{e.transport?.name ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400">{e.bale ?? '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <button onClick={() => router.push(`/despatch/${e.id}/edit`)} className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 text-xs font-medium mr-3">Edit</button>
                            <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-400 hover:text-red-600 text-xs font-medium disabled:opacity-40">
                              {deletingId === e.id ? '...' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {showImport && (
        <DespatchImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); mutate() }}
        />
      )}
      {showSync && (
        <DespatchSyncModal
          onClose={() => setShowSync(false)}
          onDone={() => { mutate() }}
        />
      )}
      <NewSheetSyncModal
        open={showNewSheetSync}
        onClose={() => setShowNewSheetSync(false)}
        onImported={mutate}
      />
      <UpdateFromSheetModal
        open={showUpdateFromSheet}
        onClose={() => setShowUpdateFromSheet(false)}
        onApplied={mutate}
      />

      {showReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl">⚠️</span>
              <div>
                <h2 className="text-lg font-bold text-red-700">Reset All Despatch Entries</h2>
                <p className="text-sm text-gray-500">This will permanently delete all {entries.length} entries from the database.</p>
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
              This action <strong>cannot be undone</strong>. Only web app database entries will be deleted — <strong>Google Sheet data is not affected</strong>. After reset, you can re-import fresh from the sheet.
            </div>
            <p className="text-sm text-gray-700 mb-2">Type <strong>RESET</strong> to confirm:</p>
            <input
              type="text"
              value={resetConfirmText}
              onChange={e => setResetConfirmText(e.target.value)}
              placeholder="Type RESET here"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowReset(false); setResetConfirmText('') }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={resetConfirmText !== 'RESET' || resetting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resetting ? 'Deleting...' : `Delete All ${entries.length} Entries`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
