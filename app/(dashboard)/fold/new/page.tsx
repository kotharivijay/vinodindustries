'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface LotStockItem {
  lotNo: string
  party: string
  quality: string
  stock: number
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

  // Build lot lookup from stock
  const lotLookup = new Map<string, LotStockItem>()
  for (const p of stockData?.parties ?? []) {
    for (const l of p.lots) {
      lotLookup.set(l.lotNo.toLowerCase(), l)
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
        // Auto-fill party/quality from stock lookup when lot number changes
        if (field === 'lotNo') {
          const lotInfo = lotLookup.get(value.toLowerCase())
          if (lotInfo) {
            const party = parties?.find(p => p.name === lotInfo.party)
            const quality = qualities?.find(q => q.name === lotInfo.quality)
            updated.partyId = party?.id ?? null
            updated.qualityId = quality?.id ?? null
            updated.partyName = lotInfo.party
            updated.qualityName = lotInfo.quality
            updated.maxStock = lotInfo.foldAvailable
            // Auto-set than to available stock
            if (!updated.than) updated.than = String(lotInfo.foldAvailable)
          }
        }
        return updated
      })
      return { ...b, lots }
    }))
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

  const allLots = stockData?.parties.flatMap(p => p.lots) ?? []

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
                const stockInfo = lotLookup.get(lot.lotNo.toLowerCase())
                return (
                  <div key={lotIdx} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <input
                        list={`lots-${batchIdx}-${lotIdx}`}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        placeholder="Lot No"
                        value={lot.lotNo}
                        onChange={e => updateLot(batchIdx, lotIdx, 'lotNo', e.target.value)}
                      />
                      <datalist id={`lots-${batchIdx}-${lotIdx}`}>
                        {allLots.map(l => <option key={l.lotNo} value={l.lotNo}>{l.lotNo} — {l.party} ({l.foldAvailable} avail)</option>)}
                      </datalist>
                      {stockInfo && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {stockInfo.party} · {stockInfo.quality} · Balance: {stockInfo.stock} · Avail: <span className="text-emerald-600 font-medium">{stockInfo.foldAvailable}</span>
                        </p>
                      )}
                    </div>
                    <input
                      type="number"
                      className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
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

  // Sync query when parent clears selection
  useEffect(() => { setQuery(shadeName) }, [shadeName])

  // Close on outside click
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
            // Clear linked shade id while typing
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

      {/* Dropdown */}
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

      {/* Show selected badge */}
      {shadeId && (
        <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5 pl-0.5">✓ Saved shade</p>
      )}
    </div>
  )
}
