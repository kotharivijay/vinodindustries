'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ─── Types ───────────────────────────────────────────────────────────────────

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
  marka: string
}

interface BatchRow {
  batchNo: number
  markas: string[]
  shadeId: number | null
  shadeName: string
  lots: LotRow[]
}

interface FoldBatchLot {
  lotNo: string
  than: number
  partyId?: number | null
  qualityId?: number | null
  party?: { name: string } | null
  quality?: { name: string } | null
}

interface FoldBatch {
  id: number
  batchNo: number
  marka?: string | null
  shadeName?: string | null
  shadeId?: number | null
  shade?: { name: string } | null
  lots: FoldBatchLot[]
}

interface FoldProgram {
  id: number
  foldNo: string
  date: string
  status: string
  notes?: string | null
  batches: FoldBatch[]
}

// ─── Edit Page ──────────────────────────────────────────────────────────────

export default function EditPcFoldPage() {
  const params = useParams()
  const router = useRouter()
  const foldId = params.id as string

  const { data: shades, mutate: mutateShades } = useSWR<Shade[]>('/api/shades', fetcher)

  const [loading, setLoading] = useState(true)
  const [foldNo, setFoldNo] = useState('')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Shade search
  const [shadeSearchMap, setShadeSearchMap] = useState<Map<number, string>>(new Map())

  // New shade inline creation
  const [creatingShadeForBatch, setCreatingShadeForBatch] = useState<number | null>(null)
  const [newShadeName, setNewShadeName] = useState('')

  // Fetch existing fold data
  useEffect(() => {
    if (!foldId) return
    setLoading(true)
    fetch(`/api/fold/pc?id=${foldId}`)
      .then(r => r.json())
      .then((data: FoldProgram) => {
        if (!data || !data.id) {
          setError('Fold not found')
          setLoading(false)
          return
        }
        setFoldNo(data.foldNo)
        setDate(data.date ? new Date(data.date).toISOString().split('T')[0] : '')
        setNotes(data.notes ?? '')

        // Convert batches to editable rows
        const rows: BatchRow[] = data.batches.map(b => {
          const markas = b.marka ? b.marka.split(',').map(m => m.trim()).filter(Boolean) : ['']
          return {
            batchNo: b.batchNo,
            markas,
            shadeId: b.shadeId ?? b.shade?.name ? (b.shadeId ?? null) : null,
            shadeName: b.shade?.name ?? b.shadeName ?? '',
            lots: b.lots.map(l => ({
              lotNo: l.lotNo,
              than: String(l.than),
              partyId: l.partyId ?? null,
              qualityId: l.qualityId ?? null,
              marka: markas[0] || '',
            })),
          }
        })
        setBatches(rows)
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load fold data')
        setLoading(false)
      })
  }, [foldId])

  // Update batch shade
  const updateBatchShade = useCallback((batchIdx: number, shadeId: number | null, shadeName: string) => {
    setBatches(prev => prev.map((b, i) =>
      i === batchIdx ? { ...b, shadeId, shadeName } : b
    ))
  }, [])

  // Create new shade
  const createShade = useCallback(async (batchIdx: number) => {
    if (!newShadeName.trim()) return
    try {
      const res = await fetch('/api/shades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newShadeName.trim() }),
      })
      if (res.ok) {
        const shade = await res.json()
        mutateShades()
        updateBatchShade(batchIdx, shade.id, shade.name)
        setCreatingShadeForBatch(null)
        setNewShadeName('')
      }
    } catch {}
  }, [newShadeName, mutateShades, updateBatchShade])

  // Update lot than
  const updateLotThan = useCallback((batchIdx: number, lotIdx: number, value: string) => {
    setBatches(prev => {
      const updated = [...prev]
      const batch = { ...updated[batchIdx] }
      const lots = [...batch.lots]
      lots[lotIdx] = { ...lots[lotIdx], than: value }
      batch.lots = lots
      updated[batchIdx] = batch
      return updated
    })
  }, [])

  // Update lot number
  const updateLotNo = useCallback((batchIdx: number, lotIdx: number, value: string) => {
    setBatches(prev => {
      const updated = [...prev]
      const batch = { ...updated[batchIdx] }
      const lots = [...batch.lots]
      lots[lotIdx] = { ...lots[lotIdx], lotNo: value }
      batch.lots = lots
      updated[batchIdx] = batch
      return updated
    })
  }, [])

  // Remove lot from batch
  const removeLot = useCallback((batchIdx: number, lotIdx: number) => {
    setBatches(prev => {
      const updated = [...prev]
      const batch = { ...updated[batchIdx] }
      batch.lots = batch.lots.filter((_, j) => j !== lotIdx)
      updated[batchIdx] = batch
      return updated
    })
  }, [])

  // Add lot to batch
  const addLot = useCallback((batchIdx: number) => {
    setBatches(prev => {
      const updated = [...prev]
      const batch = { ...updated[batchIdx] }
      batch.lots = [...batch.lots, {
        lotNo: '',
        than: '',
        partyId: null,
        qualityId: null,
        marka: batch.markas[0] || '',
      }]
      updated[batchIdx] = batch
      return updated
    })
  }, [])

  // Remove batch
  const removeBatch = useCallback((batchIdx: number) => {
    setBatches(prev =>
      prev.filter((_, i) => i !== batchIdx).map((b, i) => ({ ...b, batchNo: i + 1 }))
    )
  }, [])

  // Add batch
  const addBatch = useCallback(() => {
    const batchNo = batches.length + 1
    setBatches(prev => [...prev, {
      batchNo,
      markas: [''],
      shadeId: null,
      shadeName: '',
      lots: [{ lotNo: '', than: '', partyId: null, qualityId: null, marka: '' }],
    }])
  }, [batches.length])

  // Summary
  const summary = useMemo(() => {
    const totalLots = batches.reduce((s, b) => s + b.lots.length, 0)
    const totalThan = batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + (parseInt(l.than) || 0), 0), 0)
    return { batches: batches.length, lots: totalLots, than: totalThan }
  }, [batches])

  // Save
  const save = useCallback(async () => {
    setError('')
    if (!foldNo.trim()) { setError('Fold No is required'); return }
    if (!date) { setError('Date is required'); return }
    if (batches.length === 0) { setError('Add at least one batch'); return }
    for (const b of batches) {
      if (b.lots.length === 0) { setError(`Batch ${b.batchNo}: No lots`); return }
      for (const l of b.lots) {
        if (!l.lotNo.trim()) { setError(`Batch ${b.batchNo}: Lot No is required`); return }
        if (!l.than || parseInt(l.than) <= 0) { setError(`Batch ${b.batchNo}, Lot ${l.lotNo}: Than must be > 0`); return }
      }
    }
    setSaving(true)
    try {
      const payload = {
        id: parseInt(foldId),
        foldNo,
        date,
        notes,
        batches: batches.map(b => ({
          ...b,
          marka: b.markas.join(','),
        })),
      }
      const res = await fetch('/api/fold/pc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); setSaving(false); return }
      router.push('/fold/pc')
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }, [foldId, foldNo, date, notes, batches, router])

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-3xl">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => router.push('/fold/pc')}
            className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition"
          >
            &larr; Back
          </button>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Edit PC Fold</h1>
        </div>
        <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push('/fold/pc')}
          className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition"
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex-1">Edit PC Fold</h1>
      </div>

      {error && (
        <div className="mb-4 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Header fields */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fold No *</label>
              <input
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 dark:text-gray-100"
                value={foldNo}
                onChange={e => setFoldNo(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date *</label>
              <input
                type="date"
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 dark:text-gray-100"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
            <input
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 dark:text-gray-100"
              placeholder="Optional notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Batch sections */}
        {batches.map((batch, batchIdx) => {
          const shadeSearch = shadeSearchMap.get(batchIdx) ?? ''
          const filteredShades = (shades ?? []).filter(s =>
            !shadeSearch || s.name.toLowerCase().includes(shadeSearch.toLowerCase())
          )

          // Group lots by marka for display
          const lotsByMarka = new Map<string, { lot: LotRow; lotIdx: number }[]>()
          batch.lots.forEach((lot, lotIdx) => {
            const key = lot.marka || '(no marka)'
            const existing = lotsByMarka.get(key) ?? []
            existing.push({ lot, lotIdx })
            lotsByMarka.set(key, existing)
          })

          return (
            <div key={batchIdx} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Batch header */}
              <div className="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">
                    Batch {batch.batchNo}
                  </span>
                  {batch.markas.filter(Boolean).map(m => (
                    <span key={m} className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded">
                      {m}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => removeBatch(batchIdx)}
                  className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium"
                >
                  Remove
                </button>
              </div>

              <div className="p-4 space-y-3">
                {/* Shade selector */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Shade</label>
                  {batch.shadeId || batch.shadeName ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-800 dark:text-gray-200 font-medium">
                        {batch.shadeName || '(unnamed)'}
                      </span>
                      <button
                        onClick={() => updateBatchShade(batchIdx, null, '')}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="text"
                        className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                        placeholder="Search shade..."
                        value={shadeSearch}
                        onChange={e => setShadeSearchMap(prev => new Map(prev).set(batchIdx, e.target.value))}
                      />
                      <div className="mt-1 max-h-32 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg">
                        {filteredShades.slice(0, 20).map(s => (
                          <button
                            key={s.id}
                            onClick={() => {
                              updateBatchShade(batchIdx, s.id, s.name)
                              setShadeSearchMap(prev => { const m = new Map(prev); m.delete(batchIdx); return m })
                            }}
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-gray-800 dark:text-gray-100"
                          >
                            {s.name}
                          </button>
                        ))}
                        {creatingShadeForBatch === batchIdx ? (
                          <div className="px-3 py-2 flex items-center gap-2 border-t border-gray-200 dark:border-gray-600">
                            <input
                              type="text"
                              className="flex-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded px-2 py-1 text-sm focus:outline-none text-gray-800 dark:text-gray-100"
                              placeholder="New shade name"
                              value={newShadeName}
                              onChange={e => setNewShadeName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && createShade(batchIdx)}
                              autoFocus
                            />
                            <button
                              onClick={() => createShade(batchIdx)}
                              className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => { setCreatingShadeForBatch(null); setNewShadeName('') }}
                              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setCreatingShadeForBatch(batchIdx)}
                            className="w-full text-left px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 border-t border-gray-200 dark:border-gray-600"
                          >
                            + Create New Shade
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Lots grouped by marka */}
                {Array.from(lotsByMarka.entries()).map(([markaName, markaLots]) => {
                  const markaTotalThan = markaLots.reduce((s, { lot }) => s + (parseInt(lot.than) || 0), 0)

                  return (
                    <div key={markaName} className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                      {/* Marka header */}
                      <div className="bg-purple-50 dark:bg-purple-900/20 px-3 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-purple-700 dark:text-purple-400">{markaName}</span>
                          <span className="text-xs text-gray-400">{markaLots.length} lots</span>
                          <span className="text-xs font-semibold text-purple-600 dark:text-purple-300">{markaTotalThan}T</span>
                        </div>
                      </div>

                      <div className="p-2 space-y-2">
                        {markaLots.map(({ lot, lotIdx }) => (
                          <div key={lotIdx} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-600">
                            <input
                              type="text"
                              className="text-sm font-mono text-gray-700 dark:text-gray-300 min-w-[80px] w-24 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                              value={lot.lotNo}
                              onChange={e => updateLotNo(batchIdx, lotIdx, e.target.value)}
                              placeholder="Lot No"
                            />
                            <input
                              type="number"
                              className="w-20 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 dark:text-gray-100"
                              value={lot.than}
                              onChange={e => updateLotThan(batchIdx, lotIdx, e.target.value)}
                              placeholder="Than"
                            />
                            <span className="text-xs text-gray-400">than</span>
                            <button
                              onClick={() => removeLot(batchIdx, lotIdx)}
                              className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-400 ml-auto"
                            >
                              x
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addLot(batchIdx)}
                          className="w-full py-1.5 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                        >
                          + Add Lot
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Add Batch */}
        <button
          onClick={addBatch}
          className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
        >
          + Add Batch
        </button>

        {/* Summary */}
        {batches.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Summary</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{summary.batches}</p>
                <p className="text-[10px] text-gray-400">Batches</p>
              </div>
              <div>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{summary.lots}</p>
                <p className="text-[10px] text-gray-400">Lots</p>
              </div>
              <div>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{summary.than}</p>
                <p className="text-[10px] text-gray-400">Than</p>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/fold/pc')}
            className="flex-1 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-semibold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || batches.length === 0}
            className="flex-1 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
