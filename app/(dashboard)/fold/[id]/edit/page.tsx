'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function matchesSearch(l: LotStockItem, query: string): boolean {
  const tokens = query.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (tokens.length === 0) return true
  const fields = [l.lotNo, l.party, l.quality].map(s => (s ?? '').toLowerCase())
  return tokens.every(token => fields.some(field => field.includes(token)))
}

interface LotStockItem {
  lotNo: string
  party: string
  quality: string
  stock: number
  manuallyUsed: number
  foldAvailable: number
}

interface PartyStock {
  party: string
  partyTag?: string | null
  totalStock: number
  lots: LotStockItem[]
}

interface Shade {
  id: number
  name: string
  description?: string | null
}

interface LotRow {
  lotNo: string
  than: string
  partyId: number | null
  qualityId: number | null
  partyName: string
  qualityName: string
  maxStock: number
}

interface BatchRow {
  batchNo: number
  shadeId: number | null
  shadeName: string
  shadeDescription: string
  lots: LotRow[]
}

// ── Shade Combobox ────────────────────────────────────────────────────────────

function ShadeCombobox({ shadeId, shadeName, shades, onChange, onShadeAdded }: {
  shadeId: number | null
  shadeName: string
  shades: Shade[]
  onChange: (id: number | null, name: string) => void
  onShadeAdded: (shade: Shade) => void
}) {
  const [query, setQuery] = useState(shadeName)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(shadeName) }, [shadeName])

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filtered = shades.filter(s => s.name.toLowerCase().includes(query.toLowerCase().trim()))
  const exactMatch = shades.some(s => s.name.toLowerCase() === query.toLowerCase().trim())
  const showAdd = query.trim().length > 0 && !exactMatch

  async function addShade() {
    setAdding(true)
    try {
      const res = await fetch('/api/shades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: query.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        onShadeAdded(data)
        onChange(data.id, data.name)
        setQuery(data.name)
        setOpen(false)
      }
    } finally {
      setAdding(false)
    }
  }

  function select(id: number, name: string) {
    onChange(id, name)
    setQuery(name)
    setOpen(false)
  }

  function clear() {
    onChange(null, '')
    setQuery('')
    setOpen(true)
  }

  return (
    <div ref={ref} className="relative w-full max-w-[220px]">
      <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus-within:ring-2 focus-within:ring-indigo-400">
        <input
          className="flex-1 px-2 py-1 text-sm bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
          placeholder="Search or add shade..."
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
            if (shadeId) onChange(null, e.target.value)
          }}
          onFocus={() => setOpen(true)}
        />
        {(shadeId || query) && (
          <button onClick={clear} className="px-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs" tabIndex={-1}>&times;</button>
        )}
      </div>
      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s.id}
              onMouseDown={e => { e.preventDefault(); select(s.id, s.name) }}
              className={`w-full text-left px-3 py-2 text-sm transition ${s.id === shadeId ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >
              {s.name}
              {s.description && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">&mdash; {s.description}</span>}
            </button>
          ))}
          {showAdd && (
            <button
              onMouseDown={e => { e.preventDefault(); addShade() }}
              disabled={adding}
              className="w-full text-left px-3 py-2 text-sm text-indigo-600 dark:text-indigo-400 font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-t border-gray-100 dark:border-gray-700 disabled:opacity-50"
            >
              {adding ? 'Adding...' : `+ Add "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
      {shadeId && (
        <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5 pl-0.5">&#10003; Saved shade</p>
      )}
    </div>
  )
}

// ── Mobile Bottom Sheet ────────────────────────────────────────────────────────

function LotBottomSheet({ availableLots, currentLotNo, onSelect, onClose }: {
  availableLots: LotStockItem[]
  currentLotNo: string
  onSelect: (lotNo: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const filtered = availableLots.filter(l => matchesSearch(l, query))

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl flex flex-col max-h-[60vh]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <input
            autoFocus type="text"
            className="flex-1 text-sm bg-transparent focus:outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400"
            placeholder="Search lot, party, quality..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">Close</button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-gray-50 dark:divide-gray-700">
          {filtered.map(l => (
            <button
              key={l.lotNo}
              className={`w-full text-left px-4 py-3 text-sm flex items-center justify-between ${currentLotNo === l.lotNo ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
              onClick={() => onSelect(l.lotNo)}
            >
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">{l.lotNo}</span>
                <span className="text-xs text-gray-400 ml-2">{l.party} &middot; {l.quality}</span>
              </div>
              <span className="text-xs text-green-600 dark:text-green-400 font-semibold">{l.foldAvailable}</span>
            </button>
          ))}
          {filtered.length === 0 && query && (
            <button
              className="w-full text-left px-4 py-3 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              onClick={() => onSelect(query.trim())}
            >
              + Use &quot;{query.trim()}&quot; manually
            </button>
          )}
          {filtered.length === 0 && !query && (
            <p className="px-4 py-6 text-xs text-gray-400 text-center">No available lots</p>
          )}
        </div>
      </div>
    </>
  )
}

// ── Main Edit Page ─────────────────────────────────────────────────────────────

export default function EditFoldPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const { data: existingProgram, isLoading: loadingProgram } = useSWR<any>(`/api/fold/${id}`, fetcher)
  const { data: stockData } = useSWR<{ parties: PartyStock[] }>('/api/stock', fetcher)
  const { data: shades, mutate: mutateShades } = useSWR<Shade[]>('/api/shades', fetcher)
  const { data: parties } = useSWR<{ id: number; name: string }[]>('/api/masters/parties', fetcher)
  const { data: qualities } = useSWR<{ id: number; name: string }[]>('/api/masters/qualities', fetcher)

  const [foldNo, setFoldNo] = useState('')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lotDropKey, setLotDropKey] = useState<string | null>(null)
  const [lotSearch, setLotSearch] = useState('')
  const [isMobile, setIsMobile] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const thanRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  const [batches, setBatches] = useState<BatchRow[]>([])

  // Detect mobile viewport
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Pre-fill form when data loads
  useEffect(() => {
    if (!existingProgram || initialized) return
    setFoldNo(existingProgram.foldNo ?? '')
    setDate(existingProgram.date ? new Date(existingProgram.date).toISOString().split('T')[0] : '')
    setNotes(existingProgram.notes ?? '')
    setBatches(
      (existingProgram.batches ?? []).map((b: any) => ({
        batchNo: b.batchNo,
        shadeId: b.shade?.id ?? null,
        shadeName: b.shade?.name ?? b.shadeName ?? '',
        shadeDescription: b.shadeDescription ?? '',
        lots: (b.lots ?? []).map((l: any) => ({
          lotNo: l.lotNo,
          than: String(l.than),
          partyId: l.party?.id ?? l.partyId ?? null,
          qualityId: l.quality?.id ?? l.qualityId ?? null,
          partyName: l.party?.name ?? '',
          qualityName: l.quality?.name ?? '',
          maxStock: 0,
        })),
      }))
    )
    setInitialized(true)
  }, [existingProgram, initialized])

  // Build lot lookup from stock
  const lotLookup = new Map<string, LotStockItem>()
  for (const p of stockData?.parties ?? []) {
    for (const l of p.lots) {
      if (l.lotNo) lotLookup.set(l.lotNo.toLowerCase(), l)
    }
  }

  const allLots = (stockData?.parties ?? [])
    .flatMap(p => p.lots)
    .filter(l => l.foldAvailable > 0)

  function emptyLot(): LotRow {
    return { lotNo: '', than: '', partyId: null, qualityId: null, partyName: '', qualityName: '', maxStock: 0 }
  }

  // Per-lot already-used count across a snapshot of batches (sum of
  // `than` for the same lotNo across all batches). Used to cap auto-fill
  // + manual edits so a single fold program never over-allocates a lot
  // beyond its stock-side foldAvailable.
  function lotUsedExcludingRow(
    snapshot: BatchRow[],
    lotNo: string,
    excludeBatchIdx: number,
    excludeLotIdx: number,
  ): number {
    let used = 0
    const target = lotNo.trim().toLowerCase()
    if (!target) return 0
    snapshot.forEach((b, bi) => {
      b.lots.forEach((l, li) => {
        if (bi === excludeBatchIdx && li === excludeLotIdx) return
        if (l.lotNo.trim().toLowerCase() === target) {
          used += parseInt(l.than) || 0
        }
      })
    })
    return used
  }

  function addBatch() {
    setBatches(prev => {
      const last = prev[prev.length - 1]
      // First batch (or previous batch had no lots) → keep the original empty form
      if (!last || last.lots.length === 0) {
        return [...prev, {
          batchNo: prev.length + 1,
          shadeId: null,
          shadeName: '',
          shadeDescription: '',
          lots: [emptyLot()],
        }]
      }

      // Compute usage so far per lotNo (across ALL batches incl. last)
      const usedByLot = new Map<string, number>()
      for (const b of prev) {
        for (const l of b.lots) {
          const k = l.lotNo.trim().toLowerCase()
          if (!k) continue
          usedByLot.set(k, (usedByLot.get(k) || 0) + (parseInt(l.than) || 0))
        }
      }

      // Carry forward each lot from the previous batch, but cap at remaining
      // foldAvailable - already-used. Skip lots with 0 remaining.
      const carriedLots: LotRow[] = []
      for (const prevLot of last.lots) {
        const lotInfo = lotLookup.get(prevLot.lotNo.trim().toLowerCase())
        const desired = parseInt(prevLot.than) || 0
        if (!lotInfo || desired <= 0) continue
        const used = usedByLot.get(prevLot.lotNo.trim().toLowerCase()) || 0
        // foldAvailable already excludes this fold program's persisted usage
        // (per /api/fold/stock); subtract the modal's running total to get
        // the headroom for the new batch.
        const remaining = Math.max(0, lotInfo.foldAvailable - used)
        if (remaining <= 0) continue
        const carryThan = Math.min(desired, remaining)
        carriedLots.push({
          lotNo: prevLot.lotNo,
          than: String(carryThan),
          partyId: prevLot.partyId,
          qualityId: prevLot.qualityId,
          partyName: prevLot.partyName,
          qualityName: prevLot.qualityName,
          maxStock: lotInfo.foldAvailable,
        })
      }

      return [...prev, {
        batchNo: prev.length + 1,
        // Carry the previous shade too, since the operator usually fills the
        // same shade across consecutive batches; they can change it inline.
        shadeId: last.shadeId,
        shadeName: last.shadeName,
        shadeDescription: last.shadeDescription,
        lots: carriedLots.length > 0 ? carriedLots : [emptyLot()],
      }]
    })
  }

  function removeBatch(batchIdx: number) {
    setBatches(prev => prev.filter((_, i) => i !== batchIdx).map((b, i) => ({ ...b, batchNo: i + 1 })))
  }

  function addLot(batchIdx: number) {
    setBatches(prev => prev.map((b, i) =>
      i === batchIdx ? { ...b, lots: [...b.lots, emptyLot()] } : b
    ))
  }

  function removeLot(batchIdx: number, lotIdx: number) {
    setBatches(prev => prev.map((b, i) =>
      i === batchIdx ? { ...b, lots: b.lots.filter((_, j) => j !== lotIdx) } : b
    ))
  }

  function updateBatch(batchIdx: number, field: keyof BatchRow, value: any) {
    setBatches(prev => prev.map((b, i) =>
      i === batchIdx ? { ...b, [field]: value } : b
    ))
  }

  function updateLot(batchIdx: number, lotIdx: number, field: keyof LotRow, value: any) {
    setBatches(prev => prev.map((b, i) => {
      if (i !== batchIdx) return b
      const lots = b.lots.map((l, j) => {
        if (j !== lotIdx) return l
        const updated = { ...l, [field]: value }
        if (field === 'lotNo' && value) {
          const lotInfo = lotLookup.get((value as string).toLowerCase())
          if (lotInfo) {
            const party = Array.isArray(parties) ? parties.find(p => p.name === lotInfo.party) : undefined
            const quality = Array.isArray(qualities) ? qualities.find(q => q.name === lotInfo.quality) : undefined
            updated.partyId = party?.id ?? null
            updated.qualityId = quality?.id ?? null
            updated.partyName = lotInfo.party
            updated.qualityName = lotInfo.quality
            updated.maxStock = lotInfo.foldAvailable
            if (!updated.than) {
              const used = lotUsedExcludingRow(prev, value as string, batchIdx, lotIdx)
              const remaining = Math.max(0, lotInfo.foldAvailable - used)
              updated.than = String(remaining)
            }
          }
        }
        // Clamp `than` to whatever's left of this lot's foldAvailable after
        // accounting for usage in other rows of this modal. Prevents the
        // operator from over-allocating beyond what's physically in stock.
        if (field === 'than' && updated.lotNo) {
          const lotInfo = lotLookup.get(updated.lotNo.trim().toLowerCase())
          if (lotInfo) {
            const used = lotUsedExcludingRow(prev, updated.lotNo, batchIdx, lotIdx)
            const remaining = Math.max(0, lotInfo.foldAvailable - used)
            const requested = parseInt(String(value)) || 0
            if (requested > remaining) {
              updated.than = String(remaining)
            }
          }
        }
        return updated
      })
      return { ...b, lots }
    }))
  }

  function selectLot(batchIdx: number, lotIdx: number, lotNo: string) {
    updateLot(batchIdx, lotIdx, 'lotNo', lotNo)
    setLotDropKey(null)
    setLotSearch('')
    setTimeout(() => {
      thanRefs.current.get(`${batchIdx}-${lotIdx}`)?.focus()
    }, 80)
  }

  async function save() {
    setError('')
    if (!foldNo.trim()) { setError('Fold No is required'); return }
    if (!date) { setError('Date is required'); return }
    for (const b of batches) {
      for (const l of b.lots) {
        if (!l.lotNo.trim()) { setError(`Batch ${b.batchNo}: Lot No is required`); return }
        if (!l.than || parseInt(l.than) <= 0) { setError(`Batch ${b.batchNo}, Lot ${l.lotNo}: Than must be > 0`); return }
      }
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/fold/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foldNo, date, notes, batches }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
      router.push(`/fold/${id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Derive active batch/lot for bottom sheet
  const activeKeys = lotDropKey ? lotDropKey.split('-').map(Number) : null
  const activeBatchIdx = activeKeys?.[0] ?? null
  const activeLotIdx = activeKeys?.[1] ?? null

  if (loadingProgram) return <div className="p-8 text-gray-400 dark:text-gray-500">Loading...</div>
  if (!existingProgram) return <div className="p-8 text-red-500">Not found</div>

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex-1">Edit Fold Program</h1>
      </div>

      {error && <div className="mb-4 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm">{error}</div>}

      {/* Header fields */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fold No *</label>
            <input
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. 8"
              value={foldNo}
              onChange={e => setFoldNo(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date *</label>
            <input
              type="date"
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
          <input
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Optional notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Batches */}
      <div className="space-y-4 mb-4">
        {batches.map((batch, batchIdx) => (
          <div key={batchIdx} className="bg-white dark:bg-gray-800 rounded-xl border border-indigo-100 dark:border-gray-700 overflow-hidden">
            {/* Batch header */}
            <div className="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400 shrink-0">Batch {batch.batchNo}</span>
                <div className="flex-1">
                  <ShadeCombobox
                    shadeId={batch.shadeId}
                    shadeName={batch.shadeName}
                    shades={shades ?? []}
                    onChange={(shadeId, name) => {
                      updateBatch(batchIdx, 'shadeId', shadeId)
                      updateBatch(batchIdx, 'shadeName', name)
                      const shade = (shades ?? []).find(s => s.id === shadeId)
                      if (shade?.description) updateBatch(batchIdx, 'shadeDescription', shade.description)
                    }}
                    onShadeAdded={shade => mutateShades(prev => [...(prev ?? []), shade].sort((a, b) => a.name.localeCompare(b.name)))}
                  />
                </div>
                {batches.length > 1 && (
                  <button onClick={() => removeBatch(batchIdx)} className="text-xs text-red-500 hover:text-red-700 shrink-0">
                    Remove
                  </button>
                )}
              </div>
              <input
                type="text"
                className="w-full border border-indigo-200 dark:border-indigo-700 rounded bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                placeholder="Shade description..."
                value={batch.shadeDescription}
                onChange={e => updateBatch(batchIdx, 'shadeDescription', e.target.value)}
              />
            </div>

            {/* Lots */}
            <div className="p-3 space-y-2 bg-white dark:bg-gray-800">
              {batch.lots.map((lot, lotIdx) => {
                const dropKey = `${batchIdx}-${lotIdx}`
                const isOpen = lotDropKey === dropKey && !isMobile
                const usedElsewhere = new Map<string, number>()
                for (const [bi, b] of batches.entries()) {
                  for (const [li, l] of b.lots.entries()) {
                    if (bi === batchIdx && li === lotIdx) continue
                    if (!l.lotNo) continue
                    usedElsewhere.set(l.lotNo, (usedElsewhere.get(l.lotNo) ?? 0) + (parseInt(l.than) || 0))
                  }
                }
                const availableLots = allLots
                  .map(l => ({ ...l, foldAvailable: l.foldAvailable - (usedElsewhere.get(l.lotNo) ?? 0) }))
                  .filter(l => l.foldAvailable > 0)
                const filteredLots = availableLots.filter(l => matchesSearch(l, lotSearch))
                const stockInfo = lot.lotNo ? lotLookup.get(lot.lotNo.toLowerCase()) : undefined
                // Live remaining after every modal-side allocation of THIS lot
                // (including this row). Updates in real time as batches are added,
                // qtys edited, or rows removed.
                const usedThisRow = parseInt(lot.than) || 0
                const usedAcrossModal = (usedElsewhere.get(lot.lotNo) ?? 0) + usedThisRow
                const liveAvail = stockInfo ? Math.max(0, stockInfo.foldAvailable - usedAcrossModal) : 0
                const overAllocated = stockInfo ? usedAcrossModal > stockInfo.foldAvailable : false
                return (
                  <div key={lotIdx} className="flex gap-2 items-start">
                    <div className="flex-1 relative">
                      {/* Trigger */}
                      <div
                        className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white dark:bg-gray-700 cursor-pointer text-sm ${(lotDropKey === dropKey) ? 'ring-2 ring-indigo-400 border-indigo-400' : 'border-gray-300 dark:border-gray-600'}`}
                        onClick={() => {
                          if (lotDropKey === dropKey) {
                            setLotDropKey(null)
                            setLotSearch('')
                          } else {
                            setLotDropKey(dropKey)
                            setLotSearch('')
                          }
                        }}
                      >
                        <span className={`flex-1 ${lot.lotNo ? 'text-gray-800 dark:text-gray-100 font-medium' : 'text-gray-400'}`}>
                          {lot.lotNo || 'Select lot...'}
                        </span>
                        <span className="text-gray-400 text-xs">&#9662;</span>
                      </div>

                      {/* Stock info — Avail is LIVE (re-computes as you edit
                          qtys or add batches; stops at 0; turns red on overflow). */}
                      {stockInfo && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {stockInfo.party} &middot; {stockInfo.quality} &middot; Balance: {stockInfo.stock} &middot; Avail:{' '}
                          <span className={`font-medium ${overAllocated ? 'text-rose-600 dark:text-rose-400' : liveAvail === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {liveAvail}
                          </span>
                          <span className="text-gray-500 dark:text-gray-500"> / {stockInfo.foldAvailable}</span>
                          {overAllocated && (
                            <span className="ml-1 text-rose-600 dark:text-rose-400 font-bold">⚠ over by {usedAcrossModal - stockInfo.foldAvailable}</span>
                          )}
                        </p>
                      )}
                      {!stockInfo && lot.lotNo && lot.partyName && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {lot.partyName} &middot; {lot.qualityName}
                        </p>
                      )}

                      {/* Lot search dropdown */}
                      {isOpen && (
                        <>
                          <div className="sm:hidden fixed inset-0 bg-black/40 z-40" onClick={() => { setLotDropKey(null); setLotSearch('') }} />
                          <div className="sm:absolute sm:left-0 sm:right-0 sm:top-full sm:mt-1 sm:max-h-60 sm:z-20 fixed bottom-0 left-0 right-0 z-50 sm:relative sm:bottom-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-t-2xl sm:rounded-lg shadow-lg flex flex-col">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                              <input
                                type="text"
                                autoFocus
                                className="flex-1 text-sm focus:outline-none bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400"
                                placeholder="Search lot, party or quality..."
                                value={lotSearch}
                                onChange={e => setLotSearch(e.target.value)}
                                onClick={e => e.stopPropagation()}
                              />
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); setLotDropKey(null); setLotSearch('') }}
                                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 sm:hidden"
                              >
                                Close
                              </button>
                            </div>
                            <div className="overflow-y-auto max-h-[40vh] sm:max-h-48">
                              {filteredLots.map(l => (
                                <button
                                  key={l.lotNo}
                                  type="button"
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between ${lot.lotNo === l.lotNo ? 'bg-indigo-50 dark:bg-indigo-900/30 font-medium' : ''}`}
                                  onClick={e => { e.stopPropagation(); selectLot(batchIdx, lotIdx, l.lotNo) }}
                                >
                                  <span className="font-medium text-gray-800 dark:text-gray-200">{l.lotNo}</span>
                                  <span className="text-xs text-gray-400">{l.party} &middot; Avail: {l.foldAvailable}</span>
                                </button>
                              ))}
                              {filteredLots.length === 0 && !lotSearch && (
                                <p className="px-3 py-3 text-xs text-gray-400 text-center">No available lots</p>
                              )}
                              {filteredLots.length === 0 && lotSearch && (
                                <button
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-400 flex items-center gap-1"
                                  onClick={e => { e.stopPropagation(); selectLot(batchIdx, lotIdx, lotSearch.trim()) }}
                                >
                                  + Use &quot;{lotSearch.trim()}&quot; manually
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <input
                      type="number"
                      ref={el => {
                        if (el) thanRefs.current.set(dropKey, el)
                        else thanRefs.current.delete(dropKey)
                      }}
                      className="w-20 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      placeholder="Than"
                      value={lot.than}
                      onChange={e => updateLot(batchIdx, lotIdx, 'than', e.target.value)}
                    />
                    {batch.lots.length > 1 && (
                      <button onClick={() => removeLot(batchIdx, lotIdx)} className="text-gray-400 hover:text-red-500 text-sm pt-1.5">&times;</button>
                    )}
                  </div>
                )
              })}
              <button
                onClick={() => addLot(batchIdx)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 mt-1"
              >
                + Add Lot
              </button>
            </div>

            {/* Batch total */}
            <div className="bg-gray-50 dark:bg-gray-700/50 px-4 py-1.5 text-right">
              <span className="text-xs text-gray-500 dark:text-gray-400">Batch total: </span>
              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                {batch.lots.reduce((s, l) => s + (parseInt(l.than) || 0), 0)} than
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 items-center mb-6">
        <button
          onClick={addBatch}
          className="text-sm bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 px-4 py-2 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
        >
          + Add Batch
        </button>
        <div className="flex-1 text-right">
          <span className="text-sm text-gray-500 dark:text-gray-400">Total: </span>
          <span className="text-lg font-bold text-indigo-700 dark:text-indigo-400">
            {batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + (parseInt(l.than) || 0), 0), 0)} than
          </span>
          <span className="text-xs text-gray-400 ml-1">across {batches.length} batch{batches.length !== 1 ? 'es' : ''}</span>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
      >
        {saving ? 'Saving...' : 'Update Fold Program'}
      </button>

      {/* Mobile bottom sheet */}
      {isMobile && lotDropKey !== null && activeBatchIdx !== null && activeLotIdx !== null && (() => {
        const usedElsewhereSheet = new Map<string, number>()
        for (const [bi, b] of batches.entries()) {
          for (const [li, l] of b.lots.entries()) {
            if (bi === activeBatchIdx && li === activeLotIdx) continue
            if (!l.lotNo) continue
            usedElsewhereSheet.set(l.lotNo, (usedElsewhereSheet.get(l.lotNo) ?? 0) + (parseInt(l.than) || 0))
          }
        }
        const sheetLots = allLots
          .map(l => ({ ...l, foldAvailable: l.foldAvailable - (usedElsewhereSheet.get(l.lotNo) ?? 0) }))
          .filter(l => l.foldAvailable > 0)
        return (
          <LotBottomSheet
            availableLots={sheetLots}
            currentLotNo={batches[activeBatchIdx]?.lots[activeLotIdx]?.lotNo ?? ''}
            onSelect={lotNo => selectLot(activeBatchIdx, activeLotIdx, lotNo)}
            onClose={() => { setLotDropKey(null); setLotSearch('') }}
          />
        )
      })()}
    </div>
  )
}
