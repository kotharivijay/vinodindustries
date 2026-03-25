'use client'

import { useState, useEffect } from 'react'
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
  const { data: shades } = useSWR<Shade[]>('/api/shades', fetcher)
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
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800 flex-1">New Fold Program</h1>
      </div>

      {error && <div className="mb-4 text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm">{error}</div>}

      {/* Header fields */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
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
          <div key={batchIdx} className="bg-white rounded-xl border border-indigo-100 overflow-hidden">
            {/* Batch header */}
            <div className="bg-indigo-50 px-4 py-2 flex items-center gap-3">
              <span className="text-sm font-bold text-indigo-700">Batch {batch.batchNo}</span>
              <div className="flex-1">
                <select
                  className="border border-gray-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 w-full max-w-[180px]"
                  value={batch.shadeId ?? ''}
                  onChange={e => {
                    const id = e.target.value ? parseInt(e.target.value) : null
                    const shade = shades?.find(s => s.id === id)
                    updateBatch(batchIdx, 'shadeId', id)
                    updateBatch(batchIdx, 'shadeName', shade?.name ?? '')
                  }}
                >
                  <option value="">Select Shade...</option>
                  {(shades ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              {!batch.shadeId && (
                <input
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  placeholder="Shade name"
                  value={batch.shadeName}
                  onChange={e => updateBatch(batchIdx, 'shadeName', e.target.value)}
                />
              )}
              {batches.length > 1 && (
                <button onClick={() => removeBatch(batchIdx)} className="text-xs text-red-500 hover:text-red-700 ml-auto">
                  Remove
                </button>
              )}
            </div>

            {/* Lots */}
            <div className="p-3 space-y-2">
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
            <div className="bg-gray-50 px-4 py-1.5 text-right">
              <span className="text-xs text-gray-500">Batch total: </span>
              <span className="text-sm font-bold text-indigo-600">
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
