'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ─── Types ───────────────────────────────────────────────────────────────────

interface MarkaLot {
  lotNo: string
  greyThan: number
  availableThan: number
}

interface MarkaGroup {
  marka: string
  lots: MarkaLot[]
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
  locked: boolean
  maxAvailable: number
}

interface BatchRow {
  batchNo: number
  marka: string
  shadeId: number | null
  shadeName: string
  lots: LotRow[]
}

interface PcParty {
  id: number
  name: string
  tag: string | null
}

interface FoldBatchLot {
  lotNo: string
  than: number
  party?: { name: string }
  quality?: { name: string }
}

interface FoldBatch {
  id: number
  batchNo: number
  marka?: string
  shadeName?: string
  shade?: { name: string }
  lots: FoldBatchLot[]
  dyeingEntries?: { id: number }[]
}

interface FoldProgram {
  id: number
  foldNo: string
  date: string
  status: string
  notes?: string
  batches: FoldBatch[]
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PcFoldPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'new' | 'saved'>('new')

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition"
        >
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex-1">PC Fold Program</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('new')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'new'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          + New Fold
        </button>
        <button
          onClick={() => setTab('saved')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'saved'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Saved Folds
        </button>
      </div>

      {tab === 'new' ? <NewFoldTab /> : <SavedFoldsTab />}
    </div>
  )
}

// ─── New Fold Tab ────────────────────────────────────────────────────────────

function NewFoldTab() {
  const router = useRouter()
  const { data: parties } = useSWR<PcParty[]>('/api/masters/parties', fetcher)
  const { data: shades, mutate: mutateShades } = useSWR<Shade[]>('/api/shades', fetcher)

  // Step state
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null)
  const [partySearch, setPartySearch] = useState('')

  // Marka data
  const [markas, setMarkas] = useState<MarkaGroup[]>([])
  const [loadingMarkas, setLoadingMarkas] = useState(false)
  const [expandedMarka, setExpandedMarka] = useState<string | null>(null)

  // Batches
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [foldNo, setFoldNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Track remaining than for lots across batches (lots partially used in earlier batches)
  const [usedThanMap, setUsedThanMap] = useState<Map<string, number>>(new Map())

  // Shade search
  const [shadeSearchMap, setShadeSearchMap] = useState<Map<number, string>>(new Map())

  // New shade inline creation
  const [creatingShadeForBatch, setCreatingShadeForBatch] = useState<number | null>(null)
  const [newShadeName, setNewShadeName] = useState('')

  // Filter to Pali PC Job parties
  const pcParties = useMemo(() => {
    if (!Array.isArray(parties)) return []
    return parties.filter((p: PcParty) => p.tag === 'Pali PC Job')
  }, [parties])

  // Auto-generate fold number for PC
  useEffect(() => {
    fetch('/api/fold/pc').then(r => r.json()).then((programs: any[]) => {
      if (!Array.isArray(programs)) return
      const nums = programs.map((p: any) => {
        const match = p.foldNo.match(/^PC-?(\d+)$/i)
        return match ? parseInt(match[1]) : 0
      }).filter(n => n > 0)
      const maxNo = nums.length > 0 ? Math.max(...nums) : 0
      setFoldNo(`PC-${maxNo + 1}`)
    }).catch(() => {})
  }, [])

  // Fetch markas when party selected
  const fetchMarkas = useCallback(async (partyId: number) => {
    setLoadingMarkas(true)
    try {
      const res = await fetch(`/api/dyeing/pc/markas?partyId=${partyId}`)
      const data = await res.json()
      if (Array.isArray(data)) {
        setMarkas(data)
      }
    } catch {
      setMarkas([])
    }
    setLoadingMarkas(false)
  }, [])

  const handlePartySelect = useCallback((partyId: number) => {
    setSelectedPartyId(partyId)
    fetchMarkas(partyId)
    setExpandedMarka(null)
  }, [fetchMarkas])

  // Select a marka -> add as batch
  const selectMarka = useCallback((markaGroup: MarkaGroup) => {
    const batchNo = batches.length + 1
    const lots: LotRow[] = markaGroup.lots
      .filter(l => {
        const used = usedThanMap.get(l.lotNo) ?? 0
        return l.availableThan - used > 0
      })
      .map(l => {
        const used = usedThanMap.get(l.lotNo) ?? 0
        const remaining = l.availableThan - used
        return {
          lotNo: l.lotNo,
          than: String(remaining),
          partyId: selectedPartyId,
          qualityId: null,
          locked: false,
          maxAvailable: remaining,
        }
      })

    if (lots.length === 0) {
      setError(`No available lots remaining for marka "${markaGroup.marka}"`)
      return
    }

    setBatches(prev => [...prev, {
      batchNo,
      marka: markaGroup.marka,
      shadeId: null,
      shadeName: '',
      lots,
    }])
    setStep(2)
  }, [batches, usedThanMap, selectedPartyId])

  // Lock a lot (OK button)
  const lockLot = useCallback((batchIdx: number, lotIdx: number) => {
    setBatches(prev => {
      const updated = [...prev]
      const batch = { ...updated[batchIdx] }
      const lots = [...batch.lots]
      const lot = { ...lots[lotIdx], locked: true }
      lots[lotIdx] = lot
      batch.lots = lots
      updated[batchIdx] = batch
      return updated
    })

    // Update usedThanMap with the locked than
    setBatches(prev => {
      const lot = prev[batchIdx]?.lots[lotIdx]
      if (lot) {
        setUsedThanMap(old => {
          const m = new Map(old)
          const current = m.get(lot.lotNo) ?? 0
          m.set(lot.lotNo, current + (parseInt(lot.than) || 0))
          return m
        })
      }
      return prev
    })
  }, [])

  // Unlock a lot (Edit button)
  const unlockLot = useCallback((batchIdx: number, lotIdx: number) => {
    setBatches(prev => {
      const lot = prev[batchIdx]?.lots[lotIdx]
      if (lot) {
        // Subtract from usedThanMap
        setUsedThanMap(old => {
          const m = new Map(old)
          const current = m.get(lot.lotNo) ?? 0
          m.set(lot.lotNo, Math.max(0, current - (parseInt(lot.than) || 0)))
          return m
        })
      }
      const updated = [...prev]
      const batch = { ...updated[batchIdx] }
      const lots = [...batch.lots]
      lots[lotIdx] = { ...lots[lotIdx], locked: false }
      batch.lots = lots
      updated[batchIdx] = batch
      return updated
    })
  }, [])

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

  // Remove batch
  const removeBatch = useCallback((batchIdx: number) => {
    setBatches(prev => {
      // Un-use the than from usedThanMap for locked lots
      const batch = prev[batchIdx]
      if (batch) {
        setUsedThanMap(old => {
          const m = new Map(old)
          for (const lot of batch.lots) {
            if (lot.locked) {
              const current = m.get(lot.lotNo) ?? 0
              m.set(lot.lotNo, Math.max(0, current - (parseInt(lot.than) || 0)))
            }
          }
          return m
        })
      }
      return prev.filter((_, i) => i !== batchIdx).map((b, i) => ({ ...b, batchNo: i + 1 }))
    })
  }, [])

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

  // Save
  const save = useCallback(async () => {
    setError('')
    if (!foldNo.trim()) { setError('Fold No is required'); return }
    if (!date) { setError('Date is required'); return }
    if (batches.length === 0) { setError('Add at least one batch'); return }
    for (const b of batches) {
      if (b.lots.length === 0) { setError(`Batch ${b.batchNo} (${b.marka}): No lots`); return }
      for (const l of b.lots) {
        if (!l.lotNo.trim()) { setError(`Batch ${b.batchNo}: Lot No is required`); return }
        if (!l.than || parseInt(l.than) <= 0) { setError(`Batch ${b.batchNo}, Lot ${l.lotNo}: Than must be > 0`); return }
      }
    }
    setSaving(true)
    try {
      const res = await fetch('/api/fold/pc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foldNo, date, notes, batches }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); setSaving(false); return }
      // Reset and go to saved tab
      setBatches([])
      setStep(1)
      setSelectedPartyId(null)
      setUsedThanMap(new Map())
      setSaving(false)
      window.location.reload()
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }, [foldNo, date, notes, batches])

  // Summary
  const summary = useMemo(() => {
    const totalLots = batches.reduce((s, b) => s + b.lots.length, 0)
    const totalThan = batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + (parseInt(l.than) || 0), 0), 0)
    const uniqueMarkas = new Set(batches.map(b => b.marka)).size
    return { batches: batches.length, markas: uniqueMarkas, lots: totalLots, than: totalThan }
  }, [batches])

  const selectedPartyName = pcParties.find(p => p.id === selectedPartyId)?.name ?? ''

  return (
    <div>
      {error && (
        <div className="mb-4 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Party + Marka Selection */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Party Dropdown */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
              Select Party (Pali PC Job)
            </label>
            <input
              type="text"
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              placeholder="Search party..."
              value={partySearch}
              onChange={e => setPartySearch(e.target.value)}
            />
            <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {pcParties
                .filter(p => !partySearch || p.name.toLowerCase().includes(partySearch.toLowerCase()))
                .map(p => (
                  <button
                    key={p.id}
                    onClick={() => handlePartySelect(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                      selectedPartyId === p.id
                        ? 'bg-indigo-600 text-white'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-100'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              {pcParties.length === 0 && (
                <p className="text-sm text-gray-400 py-4 text-center">No Pali PC Job parties found</p>
              )}
            </div>
          </div>

          {/* Marka Cards */}
          {selectedPartyId && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Markas for {selectedPartyName}
                </h3>
                {loadingMarkas && <span className="text-xs text-gray-400">Loading...</span>}
              </div>

              {!loadingMarkas && markas.length === 0 && (
                <p className="text-sm text-gray-400 py-4 text-center">No markas found for this party</p>
              )}

              <div className="space-y-2">
                {markas.map(mg => {
                  const isExpanded = expandedMarka === mg.marka
                  const totalAvail = mg.lots.reduce((s, l) => {
                    const used = usedThanMap.get(l.lotNo) ?? 0
                    return s + Math.max(0, l.availableThan - used)
                  }, 0)
                  const hasAvailable = totalAvail > 0

                  return (
                    <div key={mg.marka} className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedMarka(isExpanded ? null : mg.marka)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{mg.marka}</span>
                          <span className="text-xs text-gray-400">{mg.lots.length} lots</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-sm font-bold ${hasAvailable ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`}>
                            {totalAvail} than
                          </span>
                          <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-200 dark:border-gray-600">
                          <div className="divide-y divide-gray-100 dark:divide-gray-700">
                            {mg.lots.map(l => {
                              const used = usedThanMap.get(l.lotNo) ?? 0
                              const remaining = Math.max(0, l.availableThan - used)
                              return (
                                <div key={l.lotNo} className="px-4 py-2 flex items-center justify-between text-sm">
                                  <span className="text-gray-700 dark:text-gray-300 font-mono">{l.lotNo}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-400">Grey: {l.greyThan}</span>
                                    <span className={`font-semibold ${remaining > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                                      {remaining} avail
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          {hasAvailable && (
                            <div className="p-3 border-t border-gray-200 dark:border-gray-600">
                              <button
                                onClick={() => selectMarka(mg)}
                                className="w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
                              >
                                Select This Marka
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Show existing batches if any */}
          {batches.length > 0 && (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg px-4 py-3">
              <p className="text-sm text-indigo-700 dark:text-indigo-400">
                {batches.length} batch(es) added.{' '}
                <button onClick={() => setStep(2)} className="underline font-medium">
                  Go to Configure &rarr;
                </button>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Configure Batches */}
      {step === 2 && (
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
            <p className="text-xs text-gray-500 dark:text-gray-400">Party: {selectedPartyName}</p>
          </div>

          {/* Batch sections */}
          {batches.map((batch, batchIdx) => {
            const shadeSearch = shadeSearchMap.get(batchIdx) ?? ''
            const filteredShades = (shades ?? []).filter(s =>
              !shadeSearch || s.name.toLowerCase().includes(shadeSearch.toLowerCase())
            )

            return (
              <div key={batchIdx} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Batch header */}
                <div className="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">
                      Batch {batch.batchNo}
                    </span>
                    <span className="text-sm text-indigo-600 dark:text-indigo-300 ml-2">
                      {batch.marka}
                    </span>
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

                  {/* Lots */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Lots</label>
                    <div className="space-y-2">
                      {batch.lots.map((lot, lotIdx) => (
                        <div key={lotIdx} className={`flex items-center gap-2 p-2 rounded-lg border ${
                          lot.locked
                            ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
                            : 'border-gray-200 dark:border-gray-600'
                        }`}>
                          <span className="text-sm font-mono text-gray-700 dark:text-gray-300 min-w-[80px]">
                            {lot.lotNo}
                          </span>
                          <input
                            type="number"
                            className="w-20 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 dark:text-gray-100 disabled:opacity-50"
                            value={lot.than}
                            onChange={e => updateLotThan(batchIdx, lotIdx, e.target.value)}
                            disabled={lot.locked}
                            max={lot.maxAvailable}
                          />
                          <span className="text-xs text-gray-400">/ {lot.maxAvailable}</span>
                          {lot.locked ? (
                            <button
                              onClick={() => unlockLot(batchIdx, lotIdx)}
                              className="text-xs bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700 px-2 py-1 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/30 ml-auto"
                            >
                              Edit
                            </button>
                          ) : (
                            <button
                              onClick={() => lockLot(batchIdx, lotIdx)}
                              className="text-xs bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700 px-2 py-1 rounded hover:bg-green-200 dark:hover:bg-green-900/30 ml-auto"
                            >
                              OK
                            </button>
                          )}
                          <button
                            onClick={() => removeLot(batchIdx, lotIdx)}
                            className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-400"
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Add Another Marka */}
          <button
            onClick={() => setStep(1)}
            className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
          >
            + Add Another Marka
          </button>

          {/* Summary */}
          {batches.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Summary</h3>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{summary.batches}</p>
                  <p className="text-[10px] text-gray-400">Batches</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{summary.markas}</p>
                  <p className="text-[10px] text-gray-400">Markas</p>
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

          {/* Create button */}
          <button
            onClick={save}
            disabled={saving || batches.length === 0}
            className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Creating...' : 'Create Fold'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Saved Folds Tab ─────────────────────────────────────────────────────────

function SavedFoldsTab() {
  const { data: programs, isLoading, mutate } = useSWR<FoldProgram[]>('/api/fold/pc', fetcher)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'foldNo' | 'party' | 'marka'>('date')

  const filtered = useMemo(() => {
    if (!programs) return []
    const q = search.toLowerCase()
    let list = programs.filter(p =>
      !q ||
      p.foldNo.toLowerCase().includes(q) ||
      p.batches.some(b =>
        (b.marka ?? '').toLowerCase().includes(q) ||
        b.lots.some(l =>
          l.lotNo.toLowerCase().includes(q) ||
          (l.party?.name ?? '').toLowerCase().includes(q)
        )
      )
    )

    list.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.date).getTime() - new Date(a.date).getTime()
        case 'foldNo':
          return a.foldNo.localeCompare(b.foldNo, undefined, { numeric: true })
        case 'party': {
          const pa = a.batches[0]?.lots[0]?.party?.name ?? ''
          const pb = b.batches[0]?.lots[0]?.party?.name ?? ''
          return pa.localeCompare(pb)
        }
        case 'marka': {
          const ma = a.batches[0]?.marka ?? ''
          const mb = b.batches[0]?.marka ?? ''
          return ma.localeCompare(mb)
        }
        default:
          return 0
      }
    })
    return list
  }, [programs, search, sortBy])

  const deleteProgram = useCallback(async (id: number, foldNo: string) => {
    if (!confirm(`Delete PC Fold ${foldNo}? This cannot be undone.`)) return
    await fetch(`/api/fold/pc?id=${id}`, { method: 'DELETE' })
    mutate()
  }, [mutate])

  const totalThan = (p: FoldProgram) =>
    p.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)

  if (isLoading) return <div className="text-gray-400 py-8">Loading PC fold programs...</div>

  return (
    <div>
      {/* Search */}
      <input
        type="text"
        placeholder="Search fold no, marka, party, lot..."
        className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg px-4 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Sort buttons */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['date', 'foldNo', 'party', 'marka'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              sortBy === s
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
          >
            {s === 'foldNo' ? 'Fold No' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          {(programs ?? []).length === 0 ? 'No PC fold programs yet.' : 'No results found.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => {
            const partyName = p.batches[0]?.lots[0]?.party?.name ?? '-'
            return (
              <div key={p.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                {/* Header row */}
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">{p.foldNo}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        p.status === 'confirmed'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                      }`}>
                        {p.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {new Date(p.date).toLocaleDateString('en-IN')} &middot; {partyName} &middot; {p.batches.length} batch{p.batches.length !== 1 ? 'es' : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{totalThan(p)}</p>
                    <p className="text-[10px] text-gray-400">than</p>
                  </div>
                  <button
                    onClick={() => deleteProgram(p.id, p.foldNo)}
                    className="text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-2 py-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                  >
                    Delete
                  </button>
                </div>

                {/* Batches */}
                <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
                  {p.batches.map(b => {
                    const hasDyeing = (b.dyeingEntries ?? []).length > 0
                    return (
                      <div key={b.id} className="px-4 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                            B{b.batchNo}
                          </span>
                          {b.marka && (
                            <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded">
                              {b.marka}
                            </span>
                          )}
                          {(b.shadeName || b.shade?.name) && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {b.shade?.name ?? b.shadeName}
                            </span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-auto ${
                            hasDyeing
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                          }`}>
                            {hasDyeing ? 'dyed' : 'pending'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {b.lots.map((l, i) => (
                            <span key={i} className="text-xs text-gray-500 dark:text-gray-400">
                              <span className="font-mono">{l.lotNo}</span>
                              <span className="text-indigo-600 dark:text-indigo-400 font-semibold ml-1">{l.than}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
