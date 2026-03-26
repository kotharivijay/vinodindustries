'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
  totalStock: number
  lots: LotStockItem[]
}

interface Shade {
  id: number
  name: string
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
  lots: LotRow[]
}

export default function NewFoldPage() {
  const router = useRouter()
  const { data: stockData } = useSWR<{ parties: PartyStock[] }>('/api/stock', fetcher)
  const { data: shades, mutate: mutateShades } = useSWR<Shade[]>('/api/shades', fetcher)
  const { data: parties } = useSWR<{ id: number; name: string }[]>('/api/masters/party', fetcher)
  const { data: qualities } = useSWR<{ id: number; name: string }[]>('/api/masters/quality', fetcher)

  const [foldNo, setFoldNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lotDropKey, setLotDropKey] = useState<string | null>(null)
  const [lotSearch, setLotSearch] = useState('')
  const [isMobile, setIsMobile] = useState(false)

  // Refs for Than inputs — keyed by "batchIdx-lotIdx"
  const thanRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // Detect mobile viewport
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Build lot lookup from stock
  const lotLookup = new Map<string, LotStockItem>()
  for (const p of stockData?.parties ?? []) {
    for (const l of p.lots) {
      if (l.lotNo) lotLookup.set(l.lotNo.toLowerCase(), l)
    }
  }

  const [batches, setBatches] = useState<BatchRow[]>([
    { batchNo: 1, shadeId: null, shadeName: '', lots: [emptyLot()] },
  ])

  function emptyLot(): LotRow {
    return { lotNo: '', than: '', partyId: null, qualityId: null, partyName: '', qualityName: '', maxStock: 0 }
  }

  function addBatch() {
    setBatches(prev => [...prev, {
      batchNo: prev.length + 1,
      shadeId: null,
      shadeName: '',
      lots: [emptyLot()],
    }])
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
            const party = parties?.find(p => p.name === lotInfo.party)
            const quality = qualities?.find(q => q.name === lotInfo.quality)
            updated.partyId = party?.id ?? null
            updated.qualityId = quality?.id ?? null
            updated.partyName = lotInfo.party
            updated.qualityName = lotInfo.quality
            updated.maxStock = lotInfo.foldAvailable
            if (!updated.than) updated.than = String(lotInfo.foldAvailable)
          }
        }
        return updated
      })
      return { ...b, lots }
    }))
  }

  // Select a lot and focus Than input
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
      const res = await fetch('/api/fold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foldNo, date, notes, batches }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
      router.push(`/fold/${data.id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const allLots = (stockData?.parties ?? []).flatMap(p => p.lots).filter(l => l.foldAvailable > 0)

  // Derive active batch/lot from lotDropKey for bottom sheet
  const activeKeys = lotDropKey ? lotDropKey.split('-').map(Number) : null
  const activeBatchIdx = activeKeys?.[0] ?? null
  const activeLotIdx = activeKeys?.[1] ?? null

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex-1">New Fold Program</h1>
      </div>

      {error && <div className="mb-4 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm">{error}</div>}

      {/* Header fields */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fold No *</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. FP-001"
              value={foldNo}
              onChange={e => setFoldNo(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
            <div className="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 flex items-center gap-3">
              <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400 shrink-0">Batch {batch.batchNo}</span>
              <div className="flex-1">
                <ShadeCombobox
                  shadeId={batch.shadeId}
                  shadeName={batch.shadeName}
                  shades={shades ?? []}
                  onChange={(id, name) => {
                    updateBatch(batchIdx, 'shadeId', id)
                    updateBatch(batchIdx, 'shadeName', name)
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

            {/* Lots */}
            <div className="p-3 space-y-2 bg-white dark:bg-gray-800">
              {batch.lots.map((lot, lotIdx) => {
                const dropKey = `${batchIdx}-${lotIdx}`
                const isOpen = lotDropKey === dropKey && !isMobile
                const selectedLotNos = batches.flatMap((b, bi) =>
                  b.lots.filter((_, li) => !(bi === batchIdx && li === lotIdx)).map(l => l.lotNo).filter(Boolean)
                )
                const filteredLots = allLots
                  .filter(l => !selectedLotNos.includes(l.lotNo))
                  .filter(l => matchesSearch(l, lotSearch))
                const stockInfo = lot.lotNo ? lotLookup.get(lot.lotNo.toLowerCase()) : undefined
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
                        <span className="text-gray-400 text-xs">▾</span>
                      </div>

                      {/* Stock info below trigger */}
                      {stockInfo && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {stockInfo.party} · {stockInfo.quality} · Balance: {stockInfo.stock} · Avail: <span className="text-emerald-600 font-medium">{stockInfo.foldAvailable}</span>
                        </p>
                      )}

                      {/* Desktop inline dropdown */}
                      {isOpen && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-60 flex flex-col">
                          <input
                            type="text"
                            autoFocus
                            className="w-full border-b border-gray-100 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none rounded-t-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400"
                            placeholder="Search lot, party or quality..."
                            value={lotSearch}
                            onChange={e => setLotSearch(e.target.value)}
                            onClick={e => e.stopPropagation()}
                          />
                          <div className="overflow-y-auto max-h-48">
                            {filteredLots.map(l => (
                              <button
                                key={l.lotNo}
                                type="button"
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between ${lot.lotNo === l.lotNo ? 'bg-indigo-50 dark:bg-indigo-900/30 font-medium' : ''}`}
                                onClick={e => { e.stopPropagation(); selectLot(batchIdx, lotIdx, l.lotNo) }}
                              >
                                <span className="font-medium text-gray-800 dark:text-gray-200">{l.lotNo}</span>
                                <span className="text-xs text-gray-400">{l.party} · Avail: {l.foldAvailable}</span>
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
                      <button onClick={() => removeLot(batchIdx, lotIdx)} className="text-gray-400 hover:text-red-500 text-sm pt-1.5">✕</button>
                    )}
                  </div>
                )
              })}
              <button
                onClick={() => addLot(batchIdx)}
                className="text-xs text-indigo-600 hover:text-indigo-800 mt-1"
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
          className="text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-lg hover:bg-indigo-100"
        >
          + Add Batch
        </button>
        <div className="flex-1 text-right">
          <span className="text-sm text-gray-500">Total: </span>
          <span className="text-lg font-bold text-indigo-700">
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
        {saving ? 'Saving...' : 'Save Fold Program'}
      </button>

      {/* Mobile bottom sheet */}
      {isMobile && lotDropKey !== null && activeBatchIdx !== null && activeLotIdx !== null && (
        <LotBottomSheet
          allLots={allLots}
          selectedLotNos={batches.flatMap((b, bi) =>
            b.lots.filter((_, li) => !(bi === activeBatchIdx && li === activeLotIdx)).map(l => l.lotNo).filter(Boolean)
          )}
          currentLotNo={batches[activeBatchIdx]?.lots[activeLotIdx]?.lotNo ?? ''}
          onSelect={lotNo => selectLot(activeBatchIdx, activeLotIdx, lotNo)}
          onClose={() => { setLotDropKey(null); setLotSearch('') }}
        />
      )}
    </div>
  )
}

// ── Mobile Bottom Sheet ────────────────────────────────────────────────────────

function LotBottomSheet({ allLots, selectedLotNos, currentLotNo, onSelect, onClose }: {
  allLots: LotStockItem[]
  selectedLotNos: string[]
  currentLotNo: string
  onSelect: (lotNo: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')

  // Lock body scroll while sheet is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const filtered = allLots
    .filter(l => !selectedLotNos.includes(l.lotNo))
    .filter(l => matchesSearch(l, query))

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Sheet panel */}
      <div
        className="relative bg-white dark:bg-gray-900 rounded-t-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">Select Lot</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <input
            autoFocus
            type="text"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Search lot, party or quality..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {/* Lot list */}
        <div className="overflow-y-auto overscroll-contain flex-1">
          {filtered.map(l => (
            <button
              key={l.lotNo}
              type="button"
              className={`w-full text-left px-4 py-4 flex items-center justify-between border-b border-gray-50 dark:border-gray-800 active:bg-indigo-50 dark:active:bg-indigo-900/20 ${
                l.lotNo === currentLotNo ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''
              }`}
              onClick={() => { onSelect(l.lotNo); onClose() }}
            >
              <div>
                <p className="font-semibold text-gray-800 dark:text-gray-100 text-base">{l.lotNo}</p>
                <p className="text-xs text-gray-400 mt-0.5">{l.party} · {l.quality}</p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{l.foldAvailable} avail</p>
                <p className="text-xs text-gray-400">Balance: {l.stock}</p>
              </div>
            </button>
          ))}

          {filtered.length === 0 && !query && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">No available lots</div>
          )}

          {filtered.length === 0 && query.trim() && (
            <button
              type="button"
              className="w-full text-left px-4 py-4 text-amber-700 dark:text-amber-400 font-semibold border-b border-gray-50 dark:border-gray-800 active:bg-amber-50 dark:active:bg-amber-900/20"
              onClick={() => { onSelect(query.trim()); onClose() }}
            >
              + Use &quot;{query.trim()}&quot; manually
            </button>
          )}

          {/* Bottom safe area padding */}
          <div className="h-6" />
        </div>
      </div>
    </div>
  )
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
    function handle(e: MouseEvent) {
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
          <button
            onClick={clear}
            className="px-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
            tabIndex={-1}
          >✕</button>
        )}
      </div>

      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s.id}
              onMouseDown={e => { e.preventDefault(); select(s.id, s.name) }}
              className={`w-full text-left px-3 py-2 text-sm transition ${
                s.id === shadeId
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium'
                  : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {s.name}
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
        <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5 pl-0.5">✓ Saved shade</p>
      )}
    </div>
  )
}
