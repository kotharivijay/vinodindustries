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

interface DyeingEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  notes: string | null
  chemicals: { name: string; quantity: number | null; unit: string; cost: number | null }[]
  shadeName?: string | null
  lots?: { id: number; lotNo: string; than: number }[]
  partyName?: string | null
  dyeingDoneAt?: string | null
  dyeingPhotoUrl?: string | null
  colorC?: number | null
  colorM?: number | null
  colorY?: number | null
  colorK?: number | null
  colorHex?: string | null
  machine?: { id: number; name: string } | null
  operator?: { id: number; name: string } | null
  foldBatch?: {
    batchNo: number
    foldProgram?: { foldNo: string }
    shade?: { name: string }
  } | null
}

interface LotSummaryRow {
  lotNo: string
  entries: number
  totalThan: number
  slips: string
  lastDate: string
}

type SortField = 'date' | 'slipNo' | 'lotNo' | 'than' | 'party' | 'fold'
type SortDir = 'asc' | 'desc'
type Tab = 'entries' | 'summary'

function getValue(e: DyeingEntry, f: SortField): string | number {
  switch (f) {
    case 'date': return new Date(e.date).getTime()
    case 'slipNo': return e.slipNo
    case 'lotNo': return (e.lots?.length ? e.lots.map(l => l.lotNo).join(' ') : e.lotNo).toLowerCase()
    case 'than': return e.lots?.length ? e.lots.reduce((s, l) => s + l.than, 0) : e.than
    case 'party': return (e.partyName ?? '').toLowerCase()
    case 'fold': return (e.foldBatch?.foldProgram?.foldNo ?? '').toLowerCase()
  }
}

// ─── CMYK extraction from image center ───────────────────────────────────────

function extractCMYK(base64: string, mediaType: string): Promise<{c: number, m: number, y: number, k: number, hex: string}> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const w = img.width, h = img.height
      const sx = Math.floor(w * 0.35), sy = Math.floor(h * 0.35)
      const sw = Math.floor(w * 0.3), sh = Math.floor(h * 0.3)
      canvas.width = sw; canvas.height = sh
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const data = ctx.getImageData(0, 0, sw, sh).data
      let rSum = 0, gSum = 0, bSum = 0, count = 0
      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i]; gSum += data[i+1]; bSum += data[i+2]; count++
      }
      const r = rSum / count, g = gSum / count, b = bSum / count
      const rn = r/255, gn = g/255, bn = b/255
      const k = 1 - Math.max(rn, gn, bn)
      const c = k === 1 ? 0 : (1 - rn - k) / (1 - k)
      const m = k === 1 ? 0 : (1 - gn - k) / (1 - k)
      const y = k === 1 ? 0 : (1 - bn - k) / (1 - k)
      const hex = '#' + [Math.round(r), Math.round(g), Math.round(b)].map(v => v.toString(16).padStart(2, '0')).join('')
      resolve({ c: Math.round(c*100), m: Math.round(m*100), y: Math.round(y*100), k: Math.round(k*100), hex })
    }
    img.src = `data:${mediaType};base64,${base64}`
  })
}

// ─── Image compression helper ────────────────────────────────────────────────

function readConfirmPhoto(file: File): Promise<{base64: string, mediaType: string}> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 1200
      let w = img.width, h = img.height
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      const [, data] = dataUrl.split(',')
      resolve({ base64: data, mediaType: 'image/jpeg' })
    }
    img.onerror = reject
    img.src = url
  })
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
  const [filterSlipNo, setFilterSlipNo] = useState('')
  const [debouncedFilterSlip, setDebouncedFilterSlip] = useDebounce()
  const [filterParty, setFilterParty] = useState('')
  const [debouncedFilterParty, setDebouncedFilterParty] = useDebounce()

  // ─── Confirm modal state ────────────────────────────────────────────────────
  const [confirmEntry, setConfirmEntry] = useState<DyeingEntry | null>(null)
  const [confirmPhoto, setConfirmPhoto] = useState<{base64: string, mediaType: string} | null>(null)
  const [confirmCmyk, setConfirmCmyk] = useState<{c:number,m:number,y:number,k:number,hex:string} | null>(null)
  const [confirmDate, setConfirmDate] = useState(new Date().toISOString().slice(0,10))
  const [confirmNotes, setConfirmNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const confirmCameraRef = useRef<HTMLInputElement>(null)
  const confirmGalleryRef = useRef<HTMLInputElement>(null)

  function openConfirm(e: DyeingEntry) {
    setConfirmEntry(e)
    setConfirmPhoto(null)
    setConfirmCmyk(null)
    setConfirmDate(new Date().toISOString().slice(0,10))
    setConfirmNotes('')
    setConfirming(false)
  }

  function closeConfirm() {
    setConfirmEntry(null)
    setConfirmPhoto(null)
    setConfirmCmyk(null)
  }

  async function handleConfirmPhoto(file: File) {
    const photo = await readConfirmPhoto(file)
    setConfirmPhoto(photo)
    const cmyk = await extractCMYK(photo.base64, photo.mediaType)
    setConfirmCmyk(cmyk)
  }

  async function submitConfirm() {
    if (!confirmEntry) return
    setConfirming(true)
    try {
      const res = await fetch(`/api/dyeing/${confirmEntry.id}/confirm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: confirmPhoto?.base64 || null,
          mediaType: confirmPhoto?.mediaType || null,
          date: confirmDate,
          notes: confirmNotes || null,
          colorC: confirmCmyk?.c ?? null,
          colorM: confirmCmyk?.m ?? null,
          colorY: confirmCmyk?.y ?? null,
          colorK: confirmCmyk?.k ?? null,
          colorHex: confirmCmyk?.hex ?? null,
        }),
      })
      if (res.ok) {
        mutate()
        closeConfirm()
      } else {
        const err = await res.json()
        alert(err.error || 'Failed to confirm')
      }
    } catch {
      alert('Network error')
    } finally {
      setConfirming(false)
    }
  }

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

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    const fl = debouncedFilterLot.toLowerCase()
    const fs = debouncedFilterSlip.toLowerCase()
    const fp = debouncedFilterParty.toLowerCase()

    return entries
      .filter(e => {
        const allLots = (e.lots?.length ? e.lots.map(l => l.lotNo) : [e.lotNo]).join(' ').toLowerCase()
        const foldStr = (e.foldBatch ? `fold ${e.foldBatch.foldProgram?.foldNo ?? ''} batch ${e.foldBatch.batchNo}` : '').toLowerCase()
        const shadeStr = (e.shadeName ?? e.foldBatch?.shade?.name ?? '').toLowerCase()
        const matchSearch = !q || allLots.includes(q) || String(e.slipNo).includes(q) || (e.partyName ?? '').toLowerCase().includes(q) || foldStr.includes(q) || shadeStr.includes(q)
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
  const fi = 'w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 mt-1'

  function SortTh({ field, label, right }: { field: SortField; label: string; right?: boolean }) {
    const active = sortField === field
    return (
      <th onClick={() => toggleSort(field)}
        className={`px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-purple-400 group ${right ? 'text-right' : 'text-left'}`}>
        <span className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
          {label}
          <span className={active ? 'text-purple-400' : 'text-gray-600 group-hover:text-gray-500'}>
            {active ? (sortDir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
          </span>
        </span>
      </th>
    )
  }

  // ─── Dyeing Done Status for mobile card ─────────────────────────────────────
  function DyeingStatus({ e }: { e: DyeingEntry }) {
    if (!e.dyeingDoneAt) {
      return (
        <button onClick={() => openConfirm(e)} className="mt-2 w-full flex items-center justify-center gap-2 bg-green-600/20 border border-green-700 text-green-400 rounded-lg px-3 py-2 text-xs font-medium hover:bg-green-600/30 transition">
          Confirm Dyeing Done
        </button>
      )
    }
    return (
      <div className="flex items-center gap-2 mt-2 text-xs">
        <span className="text-green-400">Done {new Date(e.dyeingDoneAt).toLocaleDateString('en-IN')}</span>
        {e.colorHex && <span className="inline-block w-4 h-4 rounded-full border border-gray-600" style={{ backgroundColor: e.colorHex }} />}
        {e.colorHex && <span className="text-gray-500">{e.colorHex}</span>}
        {e.dyeingPhotoUrl && <a href={e.dyeingPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline ml-auto">View</a>}
      </div>
    )
  }

  // ─── Dyeing Done Status for desktop table cell ──────────────────────────────
  function DyeingStatusCell({ e }: { e: DyeingEntry }) {
    if (!e.dyeingDoneAt) {
      return (
        <button onClick={() => openConfirm(e)} className="text-green-400 text-xs font-medium border border-green-700 rounded px-2 py-0.5 hover:bg-green-600/20 transition">
          Confirm
        </button>
      )
    }
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-green-400 text-xs">{new Date(e.dyeingDoneAt).toLocaleDateString('en-IN')}</span>
        {e.colorHex && <span className="inline-block w-3 h-3 rounded-full border border-gray-600" style={{ backgroundColor: e.colorHex }} />}
        {e.dyeingPhotoUrl && <a href={e.dyeingPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-xs">Photo</a>}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold text-white">Dyeing Slip</h1>
            <p className="text-sm text-gray-400 mt-1">{entries.length} entries &middot; {lotSummary.length} lots &middot; {totalThan.toLocaleString()} than</p>
          </div>
        </div>
        <Link href="/dyeing/new" className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 w-fit">
          + New Entry
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-700">
        {([['entries', 'All Entries', entries.length], ['summary', 'Lot Summary', lotSummary.length]] as const).map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === key ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {label}
            <span className="ml-2 bg-gray-700 text-gray-300 text-xs rounded-full px-2 py-0.5">{count}</span>
          </button>
        ))}
      </div>

      {/* ── LOT SUMMARY TAB ── */}
      {tab === 'summary' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Total Lots</p>
              <p className="text-2xl font-bold text-white mt-1">{lotSummary.length}</p>
            </div>
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Total Entries</p>
              <p className="text-2xl font-bold text-purple-400 mt-1">{entries.length}</p>
            </div>
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Total Than</p>
              <p className="text-2xl font-bold text-indigo-400 mt-1">{totalThan.toLocaleString()}</p>
            </div>
          </div>

          <div className="mb-4">
            <input type="text" placeholder="Search lot no..." value={lotSearch}
              onChange={e => { setLotSearchRaw(e.target.value); setDebouncedLotSearch(e.target.value) }}
              className="w-full max-w-sm bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>

          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {loading ? <div className="p-12 text-center text-gray-500">Loading...</div> :
              filteredLot.length === 0 ? <div className="p-12 text-center text-gray-500">No lots found.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-700/60 border-b border-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Lot No</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Last Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Slip Nos</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Entries</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Total Than</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {filteredLot.map(r => (
                        <tr key={r.lotNo} className="hover:bg-gray-700/40 transition">
                          <td className="px-4 py-3 font-semibold text-purple-400">
                            <Link href={`/lot/${encodeURIComponent(r.lotNo)}`} className="hover:underline">{r.lotNo}</Link>
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.lastDate).toLocaleDateString('en-IN')}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{r.slips}</td>
                          <td className="px-4 py-3 text-right text-gray-400">{r.entries}</td>
                          <td className="px-4 py-3 text-right font-semibold text-indigo-400">{r.totalThan}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-700/60 border-t-2 border-gray-600">
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Total ({filteredLot.length} lots)</td>
                        <td className="px-4 py-3 text-right font-bold text-indigo-400">{filteredLot.reduce((s, r) => s + r.totalThan, 0)}</td>
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
          {/* Filter + Sort bar */}
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-white mb-0.5">Slip No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={filterSlipNo}
                  onChange={e => { setFilterSlipNo(e.target.value); setDebouncedFilterSlip(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-white mb-0.5">Lot No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={filterLotNo}
                  onChange={e => { setFilterLotNo(e.target.value); setDebouncedFilterLot(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-white mb-0.5">Party</label>
                <input type="text" placeholder="Filter..."
                  className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={filterParty}
                  onChange={e => { setFilterParty(e.target.value); setDebouncedFilterParty(e.target.value) }} />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-gray-500">Sort:</span>
              {([['date', 'Date'], ['slipNo', 'Slip'], ['lotNo', 'Lot'], ['party', 'Party'], ['fold', 'Fold'], ['than', 'Than']] as [SortField, string][]).map(([f, label]) => (
                <button key={f} onClick={() => toggleSort(f)}
                  className={`text-xs px-2 py-1 rounded border ${sortField === f ? 'bg-purple-900/40 border-purple-600 text-purple-300 font-medium' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>
                  {label} {sortField === f ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
                </button>
              ))}
              {(filterSlipNo || filterLotNo || filterParty) && (
                <button onClick={() => { setFilterSlipNo(''); setDebouncedFilterSlip(''); setFilterLotNo(''); setDebouncedFilterLot(''); setFilterParty(''); setDebouncedFilterParty('') }}
                  className="text-xs text-red-400 hover:text-red-300">Clear</button>
              )}
              <span className="text-xs text-gray-500 ml-auto">{filtered.length} of {entries.length}</span>
            </div>
          </div>

          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {loading ? <div className="p-12 text-center text-gray-500">Loading...</div> :
              filtered.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  {entries.length === 0 ? 'No entries yet. Click + New Entry to add.' : 'No results found.'}
                </div>
              ) : (
                <>
                  {/* ── Mobile card view ── */}
                  <div className="block sm:hidden divide-y divide-gray-700">
                    {filtered.map(e => {
                      const chemCount = e.chemicals?.length ?? 0
                      const totalCost = e.chemicals?.reduce((s, c) => s + (c.cost ?? 0), 0) ?? 0
                      const lotsArr = e.lots?.length ? e.lots : [{ id: 0, lotNo: e.lotNo, than: e.than }]
                      const slipTotalThan = lotsArr.reduce((s, l) => s + l.than, 0)
                      return (
                        <div key={e.id} className="p-4">
                          <div className="flex items-start justify-between mb-1.5">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
                              <span>{new Date(e.date).toLocaleDateString('en-IN')}</span>
                              <span className="text-gray-600">&middot;</span>
                              <Link href={`/dyeing/${e.id}`} className="text-purple-400 font-medium hover:underline">Slip {e.slipNo}</Link>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => router.push(`/dyeing/${e.id}/edit`)} className="text-indigo-400 text-xs font-medium border border-indigo-700 rounded px-2 py-0.5">Edit</button>
                              <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-400 text-xs font-medium border border-red-800 rounded px-2 py-0.5 disabled:opacity-40">
                                {deletingId === e.id ? '...' : 'Del'}
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            {lotsArr.map((lot, li) => (
                              <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`} className="inline-flex items-center gap-1 bg-purple-900/40 text-purple-300 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-purple-900/60">
                                {lot.lotNo} <span className="text-purple-500 font-normal">({lot.than})</span>
                              </Link>
                            ))}
                            {lotsArr.length > 1 && <span className="text-xs text-gray-400">Total: <strong className="text-gray-200">{slipTotalThan}</strong></span>}
                          </div>
                          {chemCount > 0 && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-gray-400 bg-gray-700 px-1.5 py-0.5 rounded">{chemCount} chemicals</span>
                              {totalCost > 0 && (
                                <span className="text-[10px] text-purple-300 bg-purple-900/40 px-1.5 py-0.5 rounded font-medium">&#8377;{totalCost.toFixed(0)}</span>
                              )}
                            </div>
                          )}
                          {e.partyName && <p className="text-[10px] text-gray-400 mt-1">{e.partyName}</p>}
                          {(e.foldBatch || e.machine || e.operator) && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {e.foldBatch && (
                                <span className="text-[10px] text-indigo-300 bg-indigo-900/30 px-1.5 py-0.5 rounded font-medium">
                                  Fold {e.foldBatch.foldProgram?.foldNo ?? '?'} / B{e.foldBatch.batchNo}
                                </span>
                              )}
                              {e.machine && <span className="text-[10px] text-gray-400 bg-gray-700 px-1.5 py-0.5 rounded">{e.machine.name}</span>}
                              {e.operator && <span className="text-[10px] text-gray-400 bg-gray-700 px-1.5 py-0.5 rounded">{e.operator.name}</span>}
                            </div>
                          )}
                          {e.shadeName && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Shade</span>
                              <span className="inline-block bg-purple-700/50 text-purple-200 text-xs font-bold px-2.5 py-0.5 rounded-full border border-purple-600/40">{e.shadeName}</span>
                            </div>
                          )}
                          {e.notes && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{e.notes}</p>}
                          <DyeingStatus e={e} />
                          <Link href={`/dyeing/${e.id}/print`} target="_blank" className="mt-1 inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-purple-300">&#128424;&#65039; Print Slip</Link>
                        </div>
                      )
                    })}
                  </div>

                  {/* ── Desktop table ── */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-700/60 border-b border-gray-700">
                        <tr>
                          <SortTh field="date" label="Date" />
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-purple-400"
                            onClick={() => toggleSort('slipNo')}>
                            <span className="flex items-center gap-1">
                              Slip No <span className={sortField === 'slipNo' ? 'text-purple-400' : 'text-gray-600'}>{sortField === 'slipNo' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}</span>
                            </span>
                            <input className={fi} placeholder="filter..." value={filterSlipNo}
                              onChange={e => { e.stopPropagation(); setFilterSlipNo(e.target.value); setDebouncedFilterSlip(e.target.value) }}
                              onClick={e => e.stopPropagation()} />
                          </th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-purple-400"
                            onClick={() => toggleSort('lotNo')}>
                            <span className="flex items-center gap-1">
                              Lot No <span className={sortField === 'lotNo' ? 'text-purple-400' : 'text-gray-600'}>{sortField === 'lotNo' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}</span>
                            </span>
                            <input className={fi} placeholder="filter..." value={filterLotNo}
                              onChange={e => { e.stopPropagation(); setFilterLotNo(e.target.value); setDebouncedFilterLot(e.target.value) }}
                              onClick={e => e.stopPropagation()} />
                          </th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Shade</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-purple-400"
                            onClick={() => toggleSort('party')}>
                            <span className="flex items-center gap-1">
                              Party <span className={sortField === 'party' ? 'text-purple-400' : 'text-gray-600'}>{sortField === 'party' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}</span>
                            </span>
                            <input className={fi} placeholder="filter..." value={filterParty}
                              onChange={e => { e.stopPropagation(); setFilterParty(e.target.value); setDebouncedFilterParty(e.target.value) }}
                              onClick={e => e.stopPropagation()} />
                          </th>
                          <SortTh field="than" label="Than" right />
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Cost</th>
                          <th className="px-3 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {filtered.map(e => {
                          const dLots = e.lots?.length ? e.lots : [{ id: 0, lotNo: e.lotNo, than: e.than }]
                          const dTotalThan = dLots.reduce((s, l) => s + l.than, 0)
                          return (
                          <tr key={e.id} className="hover:bg-gray-700/40 transition text-gray-300">
                            <td className="px-3 py-2.5 whitespace-nowrap text-gray-400">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                            <td className="px-3 py-2.5 font-medium">
                              <Link href={`/dyeing/${e.id}`} className="text-purple-400 hover:underline">{e.slipNo}</Link>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {dLots.map((lot, li) => (
                                  <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`} className="inline-flex items-center gap-1 bg-purple-900/40 text-purple-300 text-xs font-semibold px-2 py-0.5 rounded-full hover:bg-purple-900/60">
                                    {lot.lotNo} <span className="text-purple-500 font-normal">({lot.than})</span>
                                  </Link>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              {e.shadeName
                                ? <span className="inline-block bg-purple-900/40 text-purple-300 text-xs font-semibold px-2 py-0.5 rounded-full">{e.shadeName}</span>
                                : <span className="text-gray-600">&mdash;</span>}
                            </td>
                            <td className="px-3 py-2.5 text-sm text-gray-400">{e.partyName ?? '\u2014'}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-gray-200">{dTotalThan}</td>
                            <td className="px-3 py-2.5 text-right font-medium text-purple-400">
                              {(() => { const c = e.chemicals?.reduce((s, x) => s + (x.cost ?? 0), 0) ?? 0; return c > 0 ? `\u20B9${c.toFixed(0)}` : '\u2014' })()}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <DyeingStatusCell e={e} />
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <Link href={`/dyeing/${e.id}/print`} target="_blank" className="text-gray-400 hover:text-purple-300 text-xs font-medium mr-3">Print</Link>
                              <button onClick={() => router.push(`/dyeing/${e.id}/edit`)} className="text-indigo-400 hover:text-indigo-300 text-xs font-medium mr-3">Edit</button>
                              <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-red-400 hover:text-red-300 text-xs font-medium disabled:opacity-40">
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

      {/* ── Confirm Dyeing Modal ── */}
      {confirmEntry && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center">
          <div className="bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto border border-gray-700">
            {/* Modal header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-lg font-bold text-white">Confirm Dyeing Done</h2>
              <button onClick={closeConfirm} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="p-4 space-y-4">
              {/* Entry info */}
              <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-gray-400">Slip</span>
                  <span className="text-purple-400 font-semibold">{confirmEntry.slipNo}</span>
                  <span className="text-gray-600">|</span>
                  <span className="text-gray-400">Lot</span>
                  <span className="text-purple-300 font-semibold">{confirmEntry.lots?.length ? confirmEntry.lots.map(l => l.lotNo).join(', ') : confirmEntry.lotNo}</span>
                </div>
                {confirmEntry.shadeName && (
                  <div className="mt-1">
                    <span className="inline-block bg-purple-700/50 text-purple-200 text-xs font-bold px-2 py-0.5 rounded-full">{confirmEntry.shadeName}</span>
                  </div>
                )}
              </div>

              {/* Photo capture */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">Photo of dyed fabric</label>
                <div className="flex gap-2">
                  <button onClick={() => confirmCameraRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-800 border border-gray-600 text-gray-300 rounded-lg px-3 py-3 text-sm hover:bg-gray-700 transition">
                    Camera
                  </button>
                  <button onClick={() => confirmGalleryRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-800 border border-gray-600 text-gray-300 rounded-lg px-3 py-3 text-sm hover:bg-gray-700 transition">
                    Gallery
                  </button>
                </div>
                <input ref={confirmCameraRef} type="file" accept="image/*" capture className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleConfirmPhoto(f); e.target.value = '' }} />
                <input ref={confirmGalleryRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleConfirmPhoto(f); e.target.value = '' }} />
              </div>

              {/* Photo preview + CMYK */}
              {confirmPhoto && (
                <div className="space-y-3">
                  <div className="relative rounded-lg overflow-hidden border border-gray-700">
                    <img src={`data:${confirmPhoto.mediaType};base64,${confirmPhoto.base64}`} alt="Dyeing photo" className="w-full max-h-60 object-cover" />
                  </div>
                  {confirmCmyk && (
                    <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                      <div className="flex items-center gap-3">
                        <span className="inline-block w-8 h-8 rounded-lg border-2 border-gray-600" style={{ backgroundColor: confirmCmyk.hex }} />
                        <div>
                          <div className="text-sm font-mono text-gray-200">
                            C:{confirmCmyk.c} M:{confirmCmyk.m} Y:{confirmCmyk.y} K:{confirmCmyk.k}
                          </div>
                          <div className="text-xs text-gray-500 font-mono">{confirmCmyk.hex}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Date input */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Date completed</label>
                <input type="date" value={confirmDate} onChange={e => setConfirmDate(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
                <textarea value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)}
                  rows={2} placeholder="Any notes about the dyeing result..."
                  className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" />
              </div>

              {/* Submit */}
              <button onClick={submitConfirm} disabled={confirming}
                className="w-full bg-green-600 text-white font-semibold rounded-lg px-4 py-3 text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                {confirming ? 'Confirming...' : 'Confirm Dyeing Done'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
