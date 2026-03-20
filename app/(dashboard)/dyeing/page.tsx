'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function useDebounce(delay = 200) {
  const [debounced, setDebounced] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(v), delay)
  }
  return [debounced, set] as const
}

interface DyeingEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
}

interface LotSummaryRow {
  lotNo: string
  entries: number
  totalThan: number
  slips: string
  lastDate: string
}

type SortField = 'date' | 'slipNo' | 'lotNo' | 'than'
type SortDir = 'asc' | 'desc'
type Tab = 'entries' | 'summary'

function getValue(e: DyeingEntry, f: SortField): string | number {
  switch (f) {
    case 'date': return new Date(e.date).getTime()
    case 'slipNo': return e.slipNo
    case 'lotNo': return e.lotNo.toLowerCase()
    case 'than': return e.than
  }
}

export default function DyeingListPage() {
  const router = useRouter()
  const { data: entries = [], isLoading: loading, mutate } = useSWR<DyeingEntry[]>('/api/dyeing', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  const [tab, setTab] = useState<Tab>('entries')
  const [search, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useDebounce()
  const [lotSearch, setLotSearchRaw] = useState('')
  const [debouncedLotSearch, setDebouncedLotSearch] = useDebounce()
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [filterLotNo, setFilterLotNo] = useState('')
  const [debouncedFilterLot, setDebouncedFilterLot] = useDebounce()

  async function handleDelete(id: number) {
    if (!confirm('Delete this dyeing entry? This cannot be undone.')) return
    setDeletingId(id)
    await fetch(`/api/dyeing/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    mutate()
  }

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }

  const lotSummary = useMemo<LotSummaryRow[]>(() => {
    const map = new Map<string, LotSummaryRow>()
    for (const e of entries) {
      const ex = map.get(e.lotNo)
      if (!ex) {
        map.set(e.lotNo, { lotNo: e.lotNo, entries: 1, totalThan: e.than, slips: String(e.slipNo), lastDate: e.date })
      } else {
        ex.entries++
        ex.totalThan += e.than
        ex.slips = ex.slips + ', ' + e.slipNo
        if (new Date(e.date) > new Date(ex.lastDate)) ex.lastDate = e.date
      }
    }
    return Array.from(map.values()).sort((a, b) => a.lotNo.localeCompare(b.lotNo))
  }, [entries])

  const filteredLot = useMemo(() => {
    const q = debouncedLotSearch.toLowerCase()
    return !q ? lotSummary : lotSummary.filter(r => r.lotNo.toLowerCase().includes(q))
  }, [lotSummary, debouncedLotSearch])

  const filtered = useMemo(() =>
    entries
      .filter(e => {
        const q = debouncedSearch.toLowerCase()
        const fl = debouncedFilterLot.toLowerCase()
        const matchSearch = !q || e.lotNo.toLowerCase().includes(q) || String(e.slipNo).includes(q)
        const matchLot = !fl || e.lotNo.toLowerCase().includes(fl)
        return matchSearch && matchLot
      })
      .sort((a, b) => {
        const av = getValue(a, sortField), bv = getValue(b, sortField)
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      }),
  [entries, debouncedSearch, debouncedFilterLot, sortField, sortDir])

  const totalThan = useMemo(() => entries.reduce((s, e) => s + e.than, 0), [entries])
  const fi = 'w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300 mt-1'

  function SortTh({ field, label, right }: { field: SortField; label: string; right?: boolean }) {
    const active = sortField === field
    return (
      <th onClick={() => toggleSort(field)}
        className={`px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-purple-600 group ${right ? 'text-right' : 'text-left'}`}>
        <span className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
          {label}
          <span className={active ? 'text-purple-600' : 'text-gray-300 group-hover:text-gray-400'}>
            {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </span>
      </th>
    )
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Dyeing Slip</h1>
          <p className="text-sm text-gray-500 mt-1">{entries.length} entries · {lotSummary.length} lots · {totalThan.toLocaleString()} than</p>
        </div>
        <Link href="/dyeing/new" className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 w-fit">
          + New Entry
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {([['entries', 'All Entries', entries.length], ['summary', 'Lot Summary', lotSummary.length]] as const).map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === key ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
            <span className="ml-2 bg-gray-100 text-gray-600 text-xs rounded-full px-2 py-0.5">{count}</span>
          </button>
        ))}
      </div>

      {/* ── LOT SUMMARY TAB ── */}
      {tab === 'summary' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Lots</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{lotSummary.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Entries</p>
              <p className="text-2xl font-bold text-purple-600 mt-1">{entries.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Than</p>
              <p className="text-2xl font-bold text-indigo-600 mt-1">{totalThan.toLocaleString()}</p>
            </div>
          </div>

          <div className="mb-4">
            <input type="text" placeholder="Search lot no..." value={lotSearch}
              onChange={e => { setLotSearchRaw(e.target.value); setDebouncedLotSearch(e.target.value) }}
              className="w-full max-w-sm border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {loading ? <div className="p-12 text-center text-gray-400">Loading...</div> :
              filteredLot.length === 0 ? <div className="p-12 text-center text-gray-400">No lots found.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Lot No</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Slip Nos</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Entries</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Than</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredLot.map(r => (
                        <tr key={r.lotNo} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 font-semibold text-purple-700">
                            <Link href={`/lot/${encodeURIComponent(r.lotNo)}`} className="hover:underline">{r.lotNo}</Link>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.lastDate).toLocaleDateString('en-IN')}</td>
                          <td className="px-4 py-3 text-gray-600 text-xs">{r.slips}</td>
                          <td className="px-4 py-3 text-right text-gray-500">{r.entries}</td>
                          <td className="px-4 py-3 text-right font-semibold text-indigo-600">{r.totalThan}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total ({filteredLot.length} lots)</td>
                        <td className="px-4 py-3 text-right font-bold text-indigo-700">{filteredLot.reduce((s, r) => s + r.totalThan, 0)}</td>
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
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input type="text" placeholder="Search lot no, slip no..."
              className="w-full max-w-sm border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              value={search}
              onChange={e => { setSearchRaw(e.target.value); setDebouncedSearch(e.target.value) }} />
            {(search || filterLotNo) && (
              <button onClick={() => { setSearchRaw(''); setDebouncedSearch(''); setFilterLotNo(''); setDebouncedFilterLot('') }}
                className="text-xs text-gray-400 hover:text-red-500">Clear filters</button>
            )}
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} of {entries.length}</span>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {loading ? <div className="p-12 text-center text-gray-400">Loading...</div> :
              filtered.length === 0 ? (
                <div className="p-12 text-center text-gray-400">
                  {entries.length === 0 ? 'No entries yet. Click + New Entry to add.' : 'No results found.'}
                </div>
              ) : (
                <>
                  {/* ── Mobile card view ── */}
                  <div className="block sm:hidden divide-y divide-gray-100">
                    {filtered.map(e => (
                      <div key={e.id} className="p-4">
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                            <span>{new Date(e.date).toLocaleDateString('en-IN')}</span>
                            <span className="text-gray-300">·</span>
                            <span>Slip {e.slipNo}</span>
                          </div>
                          <div className="flex gap-3 shrink-0">
                            <button onClick={() => router.push(`/dyeing/${e.id}/edit`)} className="text-indigo-500 text-xs font-medium">Edit</button>
                            <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-400 text-xs font-medium">{deletingId === e.id ? '...' : 'Del'}</button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/lot/${encodeURIComponent(e.lotNo)}`} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-purple-100 active:bg-purple-200">
                            🔖 {e.lotNo}
                          </Link>
                          <span className="text-xs text-gray-600">Than: <strong>{e.than}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Desktop table ── */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <SortTh field="date" label="Date" />
                          <SortTh field="slipNo" label="Slip No" />
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-purple-600"
                            onClick={() => toggleSort('lotNo')}>
                            <span className="flex items-center gap-1">
                              Lot No <span className={sortField === 'lotNo' ? 'text-purple-600' : 'text-gray-300'}>{sortField === 'lotNo' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                            </span>
                            <input className={fi} placeholder="filter..." value={filterLotNo}
                              onChange={e => { e.stopPropagation(); setFilterLotNo(e.target.value); setDebouncedFilterLot(e.target.value) }}
                              onClick={e => e.stopPropagation()} />
                          </th>
                          <SortTh field="than" label="Than" right />
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filtered.map(e => (
                          <tr key={e.id} className="hover:bg-gray-50 transition">
                            <td className="px-3 py-2.5 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                            <td className="px-3 py-2.5 font-medium">{e.slipNo}</td>
                            <td className="px-3 py-2.5 font-semibold text-purple-700">
                              <Link href={`/lot/${encodeURIComponent(e.lotNo)}`} className="hover:underline">{e.lotNo}</Link>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold">{e.than}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <button onClick={() => router.push(`/dyeing/${e.id}/edit`)} className="text-indigo-500 hover:text-indigo-700 text-xs font-medium mr-3">Edit</button>
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
    </div>
  )
}
