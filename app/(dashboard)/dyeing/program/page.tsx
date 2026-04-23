'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import BackButton from '../../BackButton'
import { useRole } from '../../RoleContext'

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

interface DyeingLot { id: number; lotNo: string; than: number }
interface DyeingChemical { name: string; quantity: number | null; unit: string; cost: number | null }
interface DyeingEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  notes: string | null
  shadeName: string | null
  lots: DyeingLot[]
  chemicals: DyeingChemical[]
  partyName: string | null
  marka: string | null
  isPcJob: boolean
  machine: { id: number; name: string } | null
  operator: { id: number; name: string } | null
  foldBatch: { batchNo: number; foldProgram?: { foldNo: string }; shade?: { name: string } } | null
  status: string
  totalRounds: number
  dyeingDoneAt: string | null
  additions: any[]
}

type Filter = 'all' | 'ksi' | 'pc'
type SortField = 'date' | 'slipNo' | 'lotNo' | 'party' | 'than'
type SortDir = 'asc' | 'desc'

export default function DyeingProgramPage() {
  const role = useRole()
  const { data: entries = [], isLoading, mutate } = useSWR<DyeingEntry[]>('/api/dyeing', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useDebounce()
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // Pali PC Job party names for auto-detection
  const { data: parties = [] } = useSWR<{ id: number; name: string; tag: string | null }[]>('/api/masters/parties', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const paliPartyNames = useMemo(() => new Set(
    parties.filter(p => p.tag?.toLowerCase().includes('pali pc job')).map(p => p.name.toLowerCase().trim())
  ), [parties])

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    let list = entries

    // Filter by type
    if (filter === 'pc') list = list.filter(e => e.isPcJob || (e.partyName && paliPartyNames.has(e.partyName.toLowerCase().trim())))
    else if (filter === 'ksi') list = list.filter(e => !e.isPcJob && !(e.partyName && paliPartyNames.has(e.partyName.toLowerCase().trim())))

    // Search
    const q = debouncedSearch.toLowerCase()
    if (q) {
      list = list.filter(e => {
        const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
        return String(e.slipNo).includes(q) ||
          lots.some(l => l.lotNo.toLowerCase().includes(q)) ||
          (e.partyName || '').toLowerCase().includes(q) ||
          (e.shadeName || '').toLowerCase().includes(q) ||
          (e.marka || '').toLowerCase().includes(q) ||
          (e.foldBatch?.foldProgram?.foldNo || '').toLowerCase().includes(q)
      })
    }

    // Sort
    list = [...list].sort((a, b) => {
      let va: any, vb: any
      switch (sortField) {
        case 'date': va = new Date(a.date).getTime(); vb = new Date(b.date).getTime(); break
        case 'slipNo': va = a.slipNo; vb = b.slipNo; break
        case 'lotNo': va = (a.lots?.[0]?.lotNo || a.lotNo).toLowerCase(); vb = (b.lots?.[0]?.lotNo || b.lotNo).toLowerCase(); break
        case 'party': va = (a.partyName || '').toLowerCase(); vb = (b.partyName || '').toLowerCase(); break
        case 'than': va = a.lots?.reduce((s, l) => s + l.than, 0) || a.than; vb = b.lots?.reduce((s, l) => s + l.than, 0) || b.than; break
      }
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })

    return list
  }, [entries, filter, debouncedSearch, sortField, sortDir, paliPartyNames])

  async function handleDelete(id: number) {
    if (!confirm('Delete this entry?')) return
    setDeletingId(id)
    await fetch(`/api/dyeing/${id}`, { method: 'DELETE' }).catch(() => {})
    mutate()
    setDeletingId(null)
  }

  // Stats
  const totalEntries = filtered.length
  const totalThan = filtered.reduce((s, e) => s + (e.lots?.reduce((ls, l) => ls + l.than, 0) || e.than), 0)
  const pcCount = filtered.filter(e => e.isPcJob || (e.partyName && paliPartyNames.has(e.partyName.toLowerCase().trim()))).length
  const doneCount = filtered.filter(e => e.dyeingDoneAt).length

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-4 mb-5">
        <BackButton />
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Dyeing Program</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase">Entries</p>
          <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{totalEntries}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase">Than</p>
          <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{totalThan}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase">PC Jobs</p>
          <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{pcCount}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase">Done</p>
          <p className="text-xl font-bold text-green-600 dark:text-green-400">{doneCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-3">
        {/* Type filter */}
        <div className="flex gap-2">
          {([['all', 'All'], ['ksi', 'KSI Only'], ['pc', 'PC Jobs']] as [Filter, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition ${filter === key
                ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/40'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input type="text" placeholder="Search slip, lot, party, shade, marka, fold..."
          value={search}
          onChange={e => { setSearch(e.target.value); setDebouncedSearch(e.target.value) }}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-400" />

        {/* Sort */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-400">Sort:</span>
          {([['date', 'Date'], ['slipNo', 'Slip'], ['lotNo', 'Lot'], ['party', 'Party'], ['than', 'Than']] as [SortField, string][]).map(([f, label]) => (
            <button key={f} onClick={() => toggleSort(f)}
              className={`text-xs px-2 py-1 rounded border ${sortField === f ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 font-medium' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}>
              {label} {sortField === f ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </button>
          ))}
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} of {entries.length}</span>
        </div>
      </div>

      {/* Entry list */}
      {isLoading ? <div className="p-12 text-center text-gray-400">Loading...</div> :
        filtered.length === 0 ? <div className="p-12 text-center text-gray-400">No entries found.</div> : (
          <div className="space-y-2">
            {filtered.map(e => {
              const lots = e.lots?.length ? e.lots : [{ id: 0, lotNo: e.lotNo, than: e.than }]
              const slipThan = lots.reduce((s, l) => s + l.than, 0)
              const isPali = e.isPcJob || (e.partyName && paliPartyNames.has(e.partyName.toLowerCase().trim()))
              const totalCost = e.chemicals?.reduce((s, c) => s + (c.cost ?? 0), 0) ?? 0
              const shade = e.shadeName || e.foldBatch?.shade?.name || null
              const foldNo = e.foldBatch?.foldProgram?.foldNo || null

              return (
                <div key={e.id} className={`bg-white dark:bg-gray-800 rounded-xl border shadow-sm overflow-hidden ${isPali ? 'border-amber-200 dark:border-amber-800' : 'border-gray-100 dark:border-gray-700'}`}>
                  {/* Header row */}
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-gray-400">{new Date(e.date).toLocaleDateString('en-IN')}</span>
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <Link href={`/dyeing/${e.id}`} className="text-purple-500 dark:text-purple-400 font-medium hover:underline">Slip {e.slipNo}</Link>
                        {isPali && <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">PC</span>}
                        {e.marka && <span className="text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">🏷️ {e.marka}</span>}
                        {e.dyeingDoneAt && <span className="text-[10px] text-green-600 dark:text-green-400">✅</span>}
                        {e.status === 'patchy' && <span className="text-[10px] text-red-400">Patchy</span>}
                        {e.status === 're-dyeing' && <span className="text-[10px] text-amber-400">Re-dye</span>}
                      </div>
                      <span className="text-sm font-bold text-purple-600 dark:text-purple-400">{slipThan}</span>
                    </div>

                    {/* Fold + Shade */}
                    {(foldNo || shade) && (
                      <div className="flex items-center gap-2 mb-1">
                        {foldNo && <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-900/20 px-1.5 py-0.5 rounded">Fold {foldNo}</span>}
                        {shade && <span className="text-[10px] text-gray-600 dark:text-gray-300 bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded">{shade}</span>}
                      </div>
                    )}

                    {/* Lots */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      {lots.map((l, li) => (
                        <Link key={li} href={`/lot/${encodeURIComponent(l.lotNo)}`}
                          className="inline-flex items-center gap-0.5 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 text-xs font-semibold px-2 py-0.5 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/30">
                          {l.lotNo}<span className="text-purple-400 dark:text-purple-500 font-normal">({l.than})</span>
                        </Link>
                      ))}
                    </div>

                    {/* Party + cost */}
                    <div className="flex items-center gap-2">
                      {e.partyName && <span className="text-[10px] text-gray-500 dark:text-gray-400">{e.partyName}</span>}
                      {totalCost > 0 && <span className="text-[10px] text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded font-medium">₹{totalCost.toFixed(0)}</span>}
                      {e.machine && <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded">{e.machine.name}</span>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                      <Link href={`/dyeing/${e.id}`} className="text-xs text-blue-600 dark:text-blue-400 font-medium">View</Link>
                      <Link href={`/dyeing/${e.id}/print`} target="_blank" className="text-xs text-purple-600 dark:text-purple-400 font-medium">Print</Link>
                      <Link href={`/dyeing/${e.id}/edit`} className="text-xs text-teal-600 dark:text-teal-400 font-medium">Edit</Link>
                      {role === 'admin' && (
                        <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id}
                          className="text-xs text-red-400 hover:text-red-600 font-medium disabled:opacity-40">
                          {deletingId === e.id ? '...' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
