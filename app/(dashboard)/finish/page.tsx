'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../BackButton'

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

interface FinishEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  meter: number | null
  mandi: number | null
  notes: string | null
  chemicals: { name: string; quantity: number | null; unit: string; cost: number | null }[]
  lots?: { id: number; lotNo: string; than: number; meter: number | null }[]
  partyName?: string | null
}

interface LotSummaryRow {
  lotNo: string
  entries: number
  totalThan: number
  slips: string
  lastDate: string
}

type SortField = 'date' | 'slipNo' | 'lotNo' | 'than' | 'party'
type SortDir = 'asc' | 'desc'
type Tab = 'entries' | 'summary' | 'stock'

function getValue(e: FinishEntry, f: SortField): string | number {
  switch (f) {
    case 'date': return new Date(e.date).getTime()
    case 'slipNo': return e.slipNo
    case 'lotNo': return (e.lots?.length ? e.lots.map(l => l.lotNo).join(' ') : e.lotNo).toLowerCase()
    case 'than': return e.lots?.length ? e.lots.reduce((s, l) => s + l.than, 0) : e.than
    case 'party': return (e.partyName ?? '').toLowerCase()
  }
}

export default function FinishListPage() {
  const router = useRouter()
  const { data: entries = [], isLoading: loading, mutate } = useSWR<FinishEntry[]>('/api/finish', fetcher, {
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
  const [filterSlipNo, setFilterSlipNo] = useState('')
  const [debouncedFilterSlip, setDebouncedFilterSlip] = useDebounce()
  const [filterParty, setFilterParty] = useState('')
  const [debouncedFilterParty, setDebouncedFilterParty] = useDebounce()

  // suppress unused warnings
  void search; void lotSearch

  async function handleDelete(id: number) {
    if (!confirm('Delete this finish entry? This cannot be undone.')) return
    setDeletingId(id)
    await fetch(`/api/finish/${id}`, { method: 'DELETE' })
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

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    const fl = debouncedFilterLot.toLowerCase()
    const fs = debouncedFilterSlip.toLowerCase()
    const fp = debouncedFilterParty.toLowerCase()

    return entries
      .filter(e => {
        const allLots = (e.lots?.length ? e.lots.map(l => l.lotNo) : [e.lotNo]).join(' ').toLowerCase()
        const matchSearch = !q || allLots.includes(q) || String(e.slipNo).includes(q) || (e.partyName ?? '').toLowerCase().includes(q)
        const matchLot = !fl || allLots.includes(fl)
        const matchSlip = !fs || String(e.slipNo).includes(fs)
        const matchParty = !fp || (e.partyName ?? '').toLowerCase().includes(fp)
        return matchSearch && matchLot && matchSlip && matchParty
      })
      .sort((a, b) => {
        const av = getValue(a, sortField), bv = getValue(b, sortField)
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [entries, debouncedSearch, debouncedFilterLot, debouncedFilterSlip, debouncedFilterParty, sortField, sortDir])

  const totalThan = useMemo(() => entries.reduce((s, e) => s + e.than, 0), [entries])
  const fi = 'w-full border border-[var(--border)] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-300 mt-1'

  function SortTh({ field, label, right }: { field: SortField; label: string; right?: boolean }) {
    const active = sortField === field
    return (
      <th onClick={() => toggleSort(field)}
        className={`px-3 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-teal-600 group ${right ? 'text-right' : 'text-left'}`}>
        <span className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
          {label}
          <span className={active ? 'text-teal-600' : 'text-gray-300 group-hover:text-[var(--text-muted)]'}>
            {active ? (sortDir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
          </span>
        </span>
      </th>
    )
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)]">Finish / Center</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">{entries.length} entries &middot; {lotSummary.length} lots &middot; {totalThan.toLocaleString()} than</p>
          </div>
        </div>
        <Link href="/finish/new" className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 w-fit">
          + New Entry
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[var(--border)]">
        {([['entries', 'All Entries', entries.length], ['summary', 'Lot Summary', lotSummary.length], ['stock', '📦 Finish Stock', '...']] as [Tab, string, any][]).map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === key ? 'border-teal-600 text-teal-600' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text)]'}`}>
            {label}
            <span className="ml-2 bg-[var(--badge-bg)] text-[var(--badge-text)] text-xs rounded-full px-2 py-0.5">{count}</span>
          </button>
        ))}
      </div>

      {/* LOT SUMMARY TAB */}
      {tab === 'summary' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] shadow-sm p-4">
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">Total Lots</p>
              <p className="text-2xl font-bold text-[var(--text)] mt-1">{lotSummary.length}</p>
            </div>
            <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] shadow-sm p-4">
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">Total Entries</p>
              <p className="text-2xl font-bold text-teal-600 mt-1">{entries.length}</p>
            </div>
            <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] shadow-sm p-4">
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">Total Than</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{totalThan.toLocaleString()}</p>
            </div>
          </div>

          <div className="mb-4">
            <input type="text" placeholder="Search lot no..." value={lotSearch}
              onChange={e => { setLotSearchRaw(e.target.value); setDebouncedLotSearch(e.target.value) }}
              className="w-full max-w-sm border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>

          <div className="bg-[var(--card)] rounded-xl shadow-sm border border-[var(--border)] overflow-hidden">
            {loading ? <div className="p-12 text-center text-[var(--text-muted)]">Loading...</div> :
              filteredLot.length === 0 ? <div className="p-12 text-center text-[var(--text-muted)]">No lots found.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--bg-secondary)] border-b">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Lot No</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Last Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Slip Nos</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Entries</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Total Than</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredLot.map(r => (
                        <tr key={r.lotNo} className="hover:bg-[var(--card-hover)] transition">
                          <td className="px-4 py-3 font-semibold text-teal-700 dark:text-teal-300">
                            <Link href={`/lot/${encodeURIComponent(r.lotNo)}`} className="hover:underline">{r.lotNo}</Link>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{new Date(r.lastDate).toLocaleDateString('en-IN')}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{r.slips}</td>
                          <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{r.entries}</td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-600">{r.totalThan}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-[var(--bg-secondary)] border-t-2 border-[var(--border)]">
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Total ({filteredLot.length} lots)</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700">{filteredLot.reduce((s, r) => s + r.totalThan, 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
          </div>
        </div>
      )}

      {/* ALL ENTRIES TAB */}
      {tab === 'entries' && (
        <>
          {/* Filter + Sort bar */}
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">Slip No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterSlipNo}
                  onChange={e => { setFilterSlipNo(e.target.value); setDebouncedFilterSlip(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">Lot No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterLotNo}
                  onChange={e => { setFilterLotNo(e.target.value); setDebouncedFilterLot(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">Party</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterParty}
                  onChange={e => { setFilterParty(e.target.value); setDebouncedFilterParty(e.target.value) }} />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-[var(--text-muted)]">Sort:</span>
              {([['date', 'Date'], ['slipNo', 'Slip'], ['lotNo', 'Lot'], ['party', 'Party'], ['than', 'Than']] as [SortField, string][]).map(([f, label]) => (
                <button key={f} onClick={() => toggleSort(f)}
                  className={`text-xs px-2 py-1 rounded border ${sortField === f ? 'bg-teal-100 border-teal-300 text-teal-700 dark:text-teal-300 font-medium' : 'bg-[var(--card)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}>
                  {label} {sortField === f ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
                </button>
              ))}
              {(filterSlipNo || filterLotNo || filterParty) && (
                <button onClick={() => { setFilterSlipNo(''); setDebouncedFilterSlip(''); setFilterLotNo(''); setDebouncedFilterLot(''); setFilterParty(''); setDebouncedFilterParty('') }}
                  className="text-xs text-red-400 hover:text-red-600">Clear</button>
              )}
              <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {entries.length}</span>
            </div>
          </div>

          <div className="bg-[var(--card)] rounded-xl shadow-sm border border-[var(--border)] overflow-hidden">
            {loading ? <div className="p-12 text-center text-[var(--text-muted)]">Loading...</div> :
              filtered.length === 0 ? (
                <div className="p-12 text-center text-[var(--text-muted)]">
                  {entries.length === 0 ? 'No entries yet. Click + New Entry to add.' : 'No results found.'}
                </div>
              ) : (
                <>
                  {/* Mobile card view */}
                  <div className="block sm:hidden divide-y divide-gray-100">
                    {filtered.map(e => {
                      const chemCount = e.chemicals?.length ?? 0
                      const totalCost = e.chemicals?.reduce((s, c) => s + (c.cost ?? 0), 0) ?? 0
                      const lotsArr = e.lots?.length ? e.lots : [{ id: 0, lotNo: e.lotNo, than: e.than, meter: e.meter }]
                      const slipTotalThan = lotsArr.reduce((s, l) => s + l.than, 0)
                      return (
                        <div key={e.id} className="p-4">
                          <div className="flex items-start justify-between mb-1.5">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                              <span>{new Date(e.date).toLocaleDateString('en-IN')}</span>
                              <span className="text-gray-300">&middot;</span>
                              <Link href={`/finish/${e.id}`} className="text-teal-600 font-medium hover:underline">Slip {e.slipNo}</Link>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => router.push(`/finish/${e.id}/edit`)} className="text-teal-500 text-xs font-medium border border-teal-200 rounded px-2 py-0.5">Edit</button>
                              <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-500 text-xs font-medium border border-red-200 rounded px-2 py-0.5 disabled:opacity-40">
                                {deletingId === e.id ? '...' : 'Del'}
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            {lotsArr.map((lot, li) => (
                              <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`} className="inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/50">
                                {lot.lotNo} <span className="text-teal-400 font-normal">({lot.than})</span>
                              </Link>
                            ))}
                            {lotsArr.length > 1 && <span className="text-xs text-[var(--text-secondary)]">Total: <strong>{slipTotalThan}</strong></span>}
                          </div>
                          {chemCount > 0 && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">{chemCount} chemicals</span>
                              {totalCost > 0 && (
                                <span className="text-[10px] text-teal-600 bg-teal-50 dark:bg-teal-900/30 px-1.5 py-0.5 rounded font-medium">&#8377;{totalCost.toFixed(0)}</span>
                              )}
                            </div>
                          )}
                          {e.partyName && <p className="text-[10px] text-[var(--text-secondary)] mt-1">{e.partyName}</p>}
                          {e.notes && <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">{e.notes}</p>}
                        </div>
                      )
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--bg-secondary)] border-b">
                        <tr>
                          <SortTh field="date" label="Date" />
                          <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-teal-600"
                            onClick={() => toggleSort('slipNo')}>
                            <span className="flex items-center gap-1">
                              Slip No <span className={sortField === 'slipNo' ? 'text-teal-600' : 'text-gray-300'}>{sortField === 'slipNo' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}</span>
                            </span>
                            <input className={fi} placeholder="filter..." value={filterSlipNo}
                              onChange={e => { e.stopPropagation(); setFilterSlipNo(e.target.value); setDebouncedFilterSlip(e.target.value) }}
                              onClick={e => e.stopPropagation()} />
                          </th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-teal-600"
                            onClick={() => toggleSort('lotNo')}>
                            <span className="flex items-center gap-1">
                              Lot No <span className={sortField === 'lotNo' ? 'text-teal-600' : 'text-gray-300'}>{sortField === 'lotNo' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}</span>
                            </span>
                            <input className={fi} placeholder="filter..." value={filterLotNo}
                              onChange={e => { e.stopPropagation(); setFilterLotNo(e.target.value); setDebouncedFilterLot(e.target.value) }}
                              onClick={e => e.stopPropagation()} />
                          </th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-teal-600"
                            onClick={() => toggleSort('party')}>
                            <span className="flex items-center gap-1">
                              Party <span className={sortField === 'party' ? 'text-teal-600' : 'text-gray-300'}>{sortField === 'party' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}</span>
                            </span>
                            <input className={fi} placeholder="filter..." value={filterParty}
                              onChange={e => { e.stopPropagation(); setFilterParty(e.target.value); setDebouncedFilterParty(e.target.value) }}
                              onClick={e => e.stopPropagation()} />
                          </th>
                          <SortTh field="than" label="Than" right />
                          <th className="px-3 py-3 text-right text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Cost</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filtered.map(e => {
                          const dLots = e.lots?.length ? e.lots : [{ id: 0, lotNo: e.lotNo, than: e.than, meter: e.meter }]
                          const dTotalThan = dLots.reduce((s, l) => s + l.than, 0)
                          return (
                          <tr key={e.id} className="hover:bg-[var(--card-hover)] transition">
                            <td className="px-3 py-2.5 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                            <td className="px-3 py-2.5 font-medium">
                              <Link href={`/finish/${e.id}`} className="text-teal-600 hover:underline">{e.slipNo}</Link>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {dLots.map((lot, li) => (
                                  <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`} className="inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-xs font-semibold px-2 py-0.5 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/50">
                                    {lot.lotNo} <span className="text-teal-400 font-normal">({lot.than})</span>
                                  </Link>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-sm text-[var(--text-secondary)]">{e.partyName ?? '\u2014'}</td>
                            <td className="px-3 py-2.5 text-right font-semibold">{dTotalThan}</td>
                            <td className="px-3 py-2.5 text-right font-medium text-teal-600">
                              {(() => { const c = e.chemicals?.reduce((s, x) => s + (x.cost ?? 0), 0) ?? 0; return c > 0 ? `\u20B9${c.toFixed(0)}` : '\u2014' })()}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <button onClick={() => router.push(`/finish/${e.id}/edit`)} className="text-teal-500 hover:text-teal-700 dark:text-teal-300 text-xs font-medium mr-3">Edit</button>
                              <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-400 hover:text-red-600 text-xs font-medium disabled:opacity-40">
                                {deletingId === e.id ? '...' : 'Delete'}
                              </button>
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
          </div>
        </>
      )}

      {/* FINISH STOCK TAB */}
      {tab === 'stock' && <FinishStockTab />}
    </div>
  )
}

// ── Finish Stock Tab Component ──
function FinishStockTab() {
  const { data, isLoading } = useSWR('/api/finish/stock', fetcher, { revalidateOnFocus: false, dedupingInterval: 30000 })
  const stock = data?.stock || []
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [view, setView] = useState<'slip' | 'party'>('party')
  const [expandedParty, setExpandedParty] = useState<string | null>(null)
  const [expandedQuality, setExpandedQuality] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return stock
    const q = search.toLowerCase()
    return stock.filter((s: any) =>
      s.lotNo?.toLowerCase().includes(q) ||
      String(s.slipNo).includes(q) ||
      s.party?.toLowerCase().includes(q) ||
      s.quality?.toLowerCase().includes(q)
    )
  }, [stock, search])

  // Build party → quality → lots tree (combine same lots)
  const partyTree = useMemo(() => {
    const tree: Record<string, { party: string; totalThan: number; qualities: Record<string, { quality: string; totalThan: number; lots: Record<string, { lotNo: string; totalThan: number; slips: { slipNo: number; than: number; dyeingDoneAt: string; shade: string | null; chemicals: any[] }[] }> }> }> = {}
    for (const s of filtered) {
      const party = s.party || 'Unknown'
      const quality = s.quality || 'Unknown'
      if (!tree[party]) tree[party] = { party, totalThan: 0, qualities: {} }
      if (!tree[party].qualities[quality]) tree[party].qualities[quality] = { quality, totalThan: 0, lots: {} }
      for (const l of (s.lots || [])) {
        const lotKey = l.lotNo.toLowerCase().trim()
        tree[party].totalThan += l.than || 0
        tree[party].qualities[quality].totalThan += l.than || 0
        if (!tree[party].qualities[quality].lots[lotKey]) {
          tree[party].qualities[quality].lots[lotKey] = { lotNo: l.lotNo, totalThan: 0, slips: [] }
        }
        tree[party].qualities[quality].lots[lotKey].totalThan += l.than || 0
        tree[party].qualities[quality].lots[lotKey].slips.push({
          slipNo: s.slipNo,
          than: l.than,
          dyeingDoneAt: s.dyeingDoneAt,
          shade: s.shade || s.notes || null,
          chemicals: s.chemicals || [],
        })
      }
    }
    return Object.values(tree).sort((a, b) => b.totalThan - a.totalThan)
  }, [filtered])

  if (isLoading) return <div className="py-12 text-center text-[var(--text-muted)]">Loading finish stock...</div>

  return (
    <div>
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">Ready for Finish</p>
          <p className="text-2xl font-bold text-teal-600 mt-1">{data?.totalSlips || 0} slips</p>
        </div>
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">Total Than</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{(data?.totalThan || 0).toLocaleString()}</p>
        </div>
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">Parties</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">{partyTree.length}</p>
        </div>
      </div>

      {/* View Toggle + Search */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 bg-[var(--bg-secondary)] rounded-lg p-0.5">
          <button onClick={() => setView('party')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${view === 'party' ? 'bg-teal-600 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text)]'}`}>
            Party View
          </button>
          <button onClick={() => setView('slip')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${view === 'slip' ? 'bg-teal-600 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text)]'}`}>
            Slip View
          </button>
        </div>
        <input type="text" placeholder="Search lot, slip, party, quality..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-[var(--text-muted)]">
          {stock.length === 0 ? 'No dyeing-done slips waiting for finish.' : 'No results match your search.'}
        </div>
      ) : view === 'party' ? (
        /* ── PARTY VIEW: 3-level expansion ── */
        <div className="space-y-2">
          {partyTree.map(p => {
            const isPartyExpanded = expandedParty === p.party
            const qualities = Object.values(p.qualities).sort((a, b) => b.totalThan - a.totalThan)
            return (
              <div key={p.party} className="bg-[var(--card)] rounded-xl shadow-sm border border-[var(--border)] overflow-hidden">
                {/* Level 1: Party */}
                <button onClick={() => setExpandedParty(isPartyExpanded ? null : p.party)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition">
                  <span className="text-lg">📦</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[var(--text)] truncate">{p.party}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{qualities.length} qualit{qualities.length !== 1 ? 'ies' : 'y'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-teal-600">{p.totalThan}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">than</p>
                  </div>
                  <svg className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${isPartyExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isPartyExpanded && (
                  <div className="border-t border-[var(--border-light)] bg-[var(--bg-secondary)]">
                    {qualities.map(q => {
                      const qKey = `${p.party}|${q.quality}`
                      const isQualityExpanded = expandedQuality === qKey
                      const lotsList = Object.values(q.lots).sort((a: any, b: any) => b.totalThan - a.totalThan)
                      return (
                        <div key={q.quality} className="border-b border-[var(--border-light)] last:border-b-0">
                          {/* Level 2: Quality */}
                          <button onClick={() => setExpandedQuality(isQualityExpanded ? null : qKey)}
                            className="w-full text-left px-6 py-2.5 flex items-center gap-3 hover:bg-[var(--bg-secondary)] transition">
                            <span className="text-sm">🏷️</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[var(--text)]">{q.quality}</p>
                              <p className="text-xs text-[var(--text-muted)]">{lotsList.length} lot{lotsList.length !== 1 ? 's' : ''}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-indigo-600">{q.totalThan} than</p>
                            </div>
                            <svg className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${isQualityExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>

                          {/* Level 3: Lots (combined) */}
                          {isQualityExpanded && (
                            <div className="bg-[var(--card)] px-8 py-2 space-y-2">
                              {lotsList.map((lot: any) => (
                                <div key={lot.lotNo} className="bg-teal-50 dark:bg-teal-900/30 rounded-lg overflow-hidden">
                                  <div className="flex items-center gap-3 px-3 py-2">
                                    <Link href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                      className="text-sm font-semibold text-teal-700 dark:text-teal-300 hover:underline">
                                      {lot.lotNo}
                                    </Link>
                                    <span className="text-sm font-bold text-[var(--text)]">{lot.totalThan} than</span>
                                    <span className="text-xs text-[var(--text-muted)]">{lot.slips.length} slip{lot.slips.length !== 1 ? 's' : ''}</span>
                                    <Link href={`/finish/new?fromDyeing=0&slipNo=&lotNo=${lot.lotNo}&than=${lot.totalThan}`}
                                      className="ml-auto text-xs text-teal-600 font-medium hover:text-teal-800">
                                      Start Finish →
                                    </Link>
                                  </div>
                                  {/* Show individual slips */}
                                  <div className="px-3 pb-2 space-y-0.5">
                                    {lot.slips.map((sl: any, si: number) => (
                                      <div key={si} className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)] pl-2 flex-wrap">
                                        <span>Slip #{sl.slipNo}</span>
                                        <span>{sl.than} than</span>
                                        {sl.shade && <span className="text-purple-600 font-medium">{sl.shade}</span>}
                                        {sl.dyeingDoneAt && <span className="text-[var(--text-muted)]">{new Date(sl.dyeingDoneAt).toLocaleDateString('en-IN')}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* ── SLIP VIEW: flat list ── */
        <div className="space-y-3">
          {filtered.map((s: any) => {
            const expanded = expandedId === s.id
            return (
              <div key={s.id} className="bg-[var(--card)] rounded-xl shadow-sm border border-[var(--border)] overflow-hidden">
                <div className="p-4 cursor-pointer hover:bg-[var(--card-hover)] transition" onClick={() => setExpandedId(expanded ? null : s.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[var(--text)]">Slip #{s.slipNo}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">Dyeing Done</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 mt-1 text-xs text-[var(--text-secondary)]">
                        {s.dyeingDoneAt && <span>Done: {new Date(s.dyeingDoneAt).toLocaleDateString('en-IN')}</span>}
                        {s.party && <span>{s.party}</span>}
                        {s.quality && <span>{s.quality}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {s.lots.map((l: any, i: number) => (
                          <Link key={i} href={`/lot/${encodeURIComponent(l.lotNo)}`}
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/50">
                            {l.lotNo} <span className="text-teal-500 font-normal">({l.than} than)</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-teal-600">{s.totalThan}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">than</div>
                    </div>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-[var(--border-light)] px-4 pb-4 pt-3">
                    {s.chemicals?.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-1.5">Dyeing Chemicals Used</p>
                        <div className="space-y-1">
                          {s.chemicals.map((c: any, ci: number) => (
                            <div key={ci} className="flex items-center justify-between text-xs bg-[var(--bg-secondary)] rounded-lg px-3 py-1.5">
                              <span className="text-[var(--text)]">{c.name}</span>
                              <span className="text-[var(--text-secondary)]">{c.quantity} {c.unit}</span>
                              {c.cost && <span className="text-[var(--text-muted)]">₹{Math.round(c.cost)}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {s.notes && <p className="text-xs text-[var(--text-secondary)] mb-3">Notes: {s.notes}</p>}
                    <Link href={`/finish/new?fromDyeing=${s.id}&slipNo=${s.slipNo}&lotNo=${s.lots.map((l: any) => l.lotNo).join(',')}&than=${s.lots.map((l: any) => l.than).join(',')}`}
                      className="inline-flex items-center gap-1.5 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 transition">
                      Start Finish Entry →
                    </Link>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
