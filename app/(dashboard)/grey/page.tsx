'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import GreyImportModal from './GreyImportModal'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface GreyEntry {
  id: number; sn: number | null; date: string; challanNo: number
  lotNo: string; than: number; bale: number | null; baleNo: string | null
  weight: string | null; grayMtr: number | null; transportLrNo: string | null
  lrNo: string | null; viverNameBill: string | null; echBaleThan: number | null
  party: { name: string }; quality: { name: string }
  transport: { name: string }; weaver: { name: string }
  stock: number; tDesp: number
}

interface StockSummaryRow {
  lotNo: string; party: string; quality: string; weaver: string
  entries: number; greyThan: number; tDesp: number; stock: number; lastDate: string
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
    dedupingInterval: 30_000, // don't re-fetch if within 30s
  })

  const [search, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useDebounce('')
  const [showImport, setShowImport] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [sortField, setSortField] = useState<SortField>('sn')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [tab, setTab] = useState<Tab>('entries')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [stockSearch, setStockSearch] = useState('')
  const [debouncedStockSearch, setDebouncedStockSearch] = useDebounce('')

  const [filters, setFilters] = useState({ party: '', quality: '', lotNo: '', lrNo: '' })

  async function handleDelete(id: number) {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    setDeletingId(id)
    await fetch(`/api/grey/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    mutate()
  }

  // Stock summary — memoised so it only recomputes when entries change
  const stockSummary = useMemo<StockSummaryRow[]>(() => {
    const map = new Map<string, StockSummaryRow>()
    for (const e of entries) {
      const existing = map.get(e.lotNo)
      if (!existing) {
        map.set(e.lotNo, {
          lotNo: e.lotNo, party: e.party.name, quality: e.quality.name,
          weaver: e.weaver.name, entries: 1, greyThan: e.than,
          tDesp: e.tDesp, stock: e.stock, lastDate: e.date,
        })
      } else {
        existing.entries++
        existing.greyThan += e.than
        existing.tDesp = Math.max(existing.tDesp, e.tDesp)
        existing.stock = existing.greyThan - existing.tDesp
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

  // Filtering & sorting — memoised to avoid recomputing on unrelated state changes
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
      <th onClick={() => toggleSort(field)} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-indigo-600 group">
        <span className="flex items-center gap-1">
          {label}
          <span className={`transition ${active ? 'text-indigo-600' : 'text-gray-300 group-hover:text-gray-400'}`}>
            {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </span>
      </th>
    )
  }

  function PlainTh({ label }: { label: string }) {
    return <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{label}</th>
  }

  const fi = 'w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300 mt-1'
  const totalStock = useMemo(() => stockSummary.reduce((s, r) => s + r.stock, 0), [stockSummary])
  const lotsInStock = useMemo(() => stockSummary.filter(r => r.stock > 0).length, [stockSummary])

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Grey Inward</h1>
          <p className="text-sm text-gray-500 mt-1">{entries.length} entries · {stockSummary.length} lots · {lotsInStock} in stock</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
            📊 Import from Google Sheet
          </button>
          <Link href="/grey/new" className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
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
          Stock Summary
          <span className="ml-2 bg-gray-100 text-gray-600 text-xs rounded-full px-2 py-0.5">{stockSummary.length} lots</span>
        </button>
      </div>

      {/* ── STOCK SUMMARY TAB ── */}
      {tab === 'stock' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Lots</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{stockSummary.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Lots with Stock</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{lotsInStock}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Balance (Than)</p>
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
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {(['all', 'instock', 'cleared'] as StockFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setStockFilter(f)}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition ${stockFilter === f ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
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
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Lot No</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Party</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Quality</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Weaver</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Date</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Entries</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Grey Than</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">T_DESP</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredStock.map(r => (
                      <tr key={r.lotNo} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-3 font-semibold text-indigo-700">{r.lotNo}</td>
                        <td className="px-4 py-3 text-gray-800">{r.party}</td>
                        <td className="px-4 py-3 text-gray-600">{r.quality}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{r.weaver}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.lastDate).toLocaleDateString('en-IN')}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{r.entries}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800">{r.greyThan}</td>
                        <td className="px-4 py-3 text-right text-orange-600 font-medium">{r.tDesp}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold text-base ${r.stock > 0 ? 'text-green-600' : r.stock < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                            {r.stock}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total ({filteredStock.length} lots)</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-800">{filteredStock.reduce((s, r) => s + r.greyThan, 0)}</td>
                      <td className="px-4 py-3 text-right font-bold text-orange-600">{filteredStock.reduce((s, r) => s + r.tDesp, 0)}</td>
                      <td className="px-4 py-3 text-right font-bold text-indigo-700">{filteredStock.reduce((s, r) => s + r.stock, 0)}</td>
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

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-gray-400">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                {entries.length === 0 ? 'No entries yet. Add manually or import from Google Sheet.' : 'No results found.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
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
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50 transition">
                        <td className="px-3 py-2.5 text-gray-500">{e.sn ?? e.id}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                        <td className="px-3 py-2.5">{e.challanNo}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{e.party.name}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{e.quality.name}</td>
                        <td className="px-3 py-2.5 text-gray-500">{e.weight ?? '—'}</td>
                        <td className="px-3 py-2.5 font-semibold">{e.than}</td>
                        <td className="px-3 py-2.5 text-gray-500">{e.grayMtr ?? '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-indigo-700">{e.lotNo}</td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{e.transport.name}</td>
                        <td className="px-3 py-2.5 text-gray-500">{e.lrNo ?? e.transportLrNo ?? '—'}</td>
                        <td className="px-3 py-2.5">{e.bale ?? '—'}</td>
                        <td className="px-3 py-2.5 text-gray-500">{e.baleNo ?? '—'}</td>
                        <td className="px-3 py-2.5 text-gray-500">{e.echBaleThan ?? '—'}</td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{e.weaver.name}</td>
                        <td className="px-3 py-2.5 text-orange-600 font-medium">{e.tDesp}</td>
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
    </div>
  )
}
