'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LotInfo {
  lotNo: string
  than: number
  weightPerThan: number
}

interface RecipeItem {
  chemicalId: number
  chemicalName: string
  unit: string
  qtyPer100kg: number
  calculatedQty: number
  rate: number | null
}

interface BatchInfo {
  foldNo: string
  foldProgramId: number
  batchNo: number
  batchId: number
  shadeName: string
  shadeId: number | null
  lots: LotInfo[]
  totalThan: number
  totalWeight: number
  recipe: RecipeItem[]
}

interface ChemicalRow {
  chemicalId: number | null
  name: string
  quantity: string
  unit: string
  rate: string
  cost: number | null
}

interface ChemicalMaster {
  id: number
  name: string
  unit: string
  currentPrice: number | null
}

interface DyeingProcessItem { chemicalId: number; quantity: number; chemical: { id: number; name: string; unit: string } }
interface DyeingProcess { id: number; name: string; description?: string; items: DyeingProcessItem[] }

interface SavedEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  notes: string | null
  foldBatch?: {
    batchNo: number
    foldProgram?: { foldNo: string }
    shade?: { name: string }
  }
  chemicals: { name: string; quantity: number | null; unit: string; cost: number | null }[]
  lots: { lotNo: string; than: number }[]
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BatchDyeingPage() {
  const router = useRouter()

  // Tab state
  const [tab, setTab] = useState<'new' | 'list'>('new')

  // Data
  const [batches, setBatches] = useState<BatchInfo[]>([])
  const [savedEntries, setSavedEntries] = useState<SavedEntry[]>([])
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])
  const [loading, setLoading] = useState(true)

  // Selection
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [batchSearch, setBatchSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Chemical rows (editable)
  const [chemicals, setChemicals] = useState<ChemicalRow[]>([])

  // Slip fields
  const [slipNo, setSlipNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  // State
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Chemical dropdown state
  const [chemDropIdx, setChemDropIdx] = useState<number | null>(null)
  const [chemSearch, setChemSearch] = useState('')

  // Process presets
  const [processes, setProcesses] = useState<DyeingProcess[]>([])
  const [showPresets, setShowPresets] = useState(false)

  // ─── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch('/api/dyeing/batches').then(r => r.json()),
      fetch('/api/dyeing/batch').then(r => r.json()),
      fetch('/api/masters/chemicals').then(r => r.json()).catch(() => []),
      fetch('/api/dyeing/processes').then(r => r.json()).catch(() => []),
    ]).then(([batchData, entryData, chemData, processData]) => {
      setBatches(Array.isArray(batchData) ? batchData : [])
      setSavedEntries(Array.isArray(entryData) ? entryData : [])
      setMasterChemicals(Array.isArray(chemData) ? chemData : [])
      setProcesses(Array.isArray(processData) ? processData : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // Auto-generate next slip number
  useEffect(() => {
    if (savedEntries.length > 0 && !slipNo) {
      const maxSlip = Math.max(...savedEntries.map(e => e.slipNo), 0)
      setSlipNo(String(maxSlip + 1))
    } else if (!slipNo) {
      setSlipNo('1')
    }
  }, [savedEntries]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ─── Selected batch ─────────────────────────────────────────────────────────

  const selectedBatch = useMemo(
    () => batches.find(b => b.batchId === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  )

  // When batch selected, populate chemicals from recipe
  function selectBatch(batchId: number) {
    setSelectedBatchId(batchId)
    setDropdownOpen(false)
    setBatchSearch('')
    setError('')
    setSuccess('')

    const batch = batches.find(b => b.batchId === batchId)
    if (batch) {
      setChemicals(
        batch.recipe.map(r => ({
          chemicalId: r.chemicalId,
          name: r.chemicalName,
          quantity: String(r.calculatedQty),
          unit: r.unit,
          rate: r.rate != null ? String(r.rate) : '',
          cost: r.rate != null ? Math.round(r.calculatedQty * r.rate * 100) / 100 : null,
        }))
      )
    }
  }

  // ─── Filtered batches for dropdown ──────────────────────────────────────────

  const filteredBatches = useMemo(() => {
    if (!batchSearch.trim()) return batches
    const q = batchSearch.toLowerCase()
    return batches.filter(b => {
      const label = `${b.foldNo} batch ${b.batchNo} ${b.shadeName} ${b.lots.map(l => l.lotNo).join(' ')}`.toLowerCase()
      return label.includes(q)
    })
  }, [batches, batchSearch])

  // ─── Chemical handlers ──────────────────────────────────────────────────────

  function updateChemical(idx: number, field: keyof ChemicalRow, value: string) {
    setChemicals(prev => {
      const updated = [...prev]
      const row = { ...updated[idx] }

      if (field === 'quantity' || field === 'rate') {
        ;(row as any)[field] = value
        const qty = parseFloat(field === 'quantity' ? value : row.quantity)
        const rate = parseFloat(field === 'rate' ? value : row.rate)
        row.cost = !isNaN(qty) && !isNaN(rate) ? Math.round(qty * rate * 100) / 100 : null
      } else {
        ;(row as any)[field] = value
      }

      updated[idx] = row
      return updated
    })
  }

  function removeChemical(idx: number) {
    setChemicals(prev => prev.filter((_, i) => i !== idx))
  }

  function addChemicalRow() {
    setChemicals(prev => [
      ...prev,
      { chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null },
    ])
  }

  function selectMasterChemical(idx: number, master: ChemicalMaster) {
    setChemicals(prev => {
      const updated = [...prev]
      const row = { ...updated[idx] }
      row.chemicalId = master.id
      row.name = master.name
      row.unit = master.unit
      if (master.currentPrice != null) {
        row.rate = String(master.currentPrice)
        const qty = parseFloat(row.quantity)
        if (!isNaN(qty)) {
          row.cost = Math.round(qty * master.currentPrice * 100) / 100
        }
      }
      updated[idx] = row
      return updated
    })
    setChemDropIdx(null)
    setChemSearch('')
  }

  function applyPreset(process: DyeingProcess) {
    const rows: ChemicalRow[] = process.items.map(item => {
      const master = masterChemicals.find(m => m.id === item.chemicalId)
      const rate = master?.currentPrice != null ? String(master.currentPrice) : ''
      const qty = String(item.quantity)
      const rateNum = parseFloat(rate)
      const qtyNum = parseFloat(qty)
      const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? Math.round(rateNum * qtyNum * 100) / 100 : null
      return {
        chemicalId: item.chemicalId,
        name: item.chemical.name,
        quantity: qty,
        unit: item.chemical.unit || 'kg',
        rate,
        cost,
      }
    })
    setChemicals(rows)
    setShowPresets(false)
  }

  // ─── Totals ─────────────────────────────────────────────────────────────────

  const totalCost = useMemo(
    () => chemicals.reduce((s, c) => s + (c.cost ?? 0), 0),
    [chemicals]
  )

  const costPerThan = useMemo(
    () => (selectedBatch && selectedBatch.totalThan > 0 ? totalCost / selectedBatch.totalThan : 0),
    [totalCost, selectedBatch]
  )

  // ─── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedBatch) { setError('Please select a batch'); return }
    if (!slipNo.trim()) { setError('Slip No is required'); return }
    if (!date) { setError('Date is required'); return }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch('/api/dyeing/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          slipNo: parseInt(slipNo),
          foldBatchId: selectedBatch.batchId,
          lots: selectedBatch.lots.map(l => ({ lotNo: l.lotNo, than: l.than })),
          notes: notes.trim() || null,
          chemicals: chemicals.map(c => ({
            chemicalId: c.chemicalId,
            name: c.name,
            quantity: c.quantity ? parseFloat(c.quantity) : null,
            unit: c.unit,
            rate: c.rate ? parseFloat(c.rate) : null,
            cost: c.cost,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to save')
      }

      const saved = await res.json()
      setSuccess(`Dyeing Batch Slip #${saved.slipNo} saved successfully!`)
      setSavedEntries(prev => [saved, ...prev])

      // Reset form
      setSelectedBatchId(null)
      setChemicals([])
      setNotes('')
      setSlipNo(String(parseInt(slipNo) + 1))
    } catch (err: any) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/2" />
          <div className="h-40 bg-gray-200 rounded" />
          <div className="h-40 bg-gray-200 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Dyeing Slip (Batch)</h1>
          <p className="text-xs text-gray-400 mt-0.5">Create dyeing slips from fold program batches</p>
        </div>
        <Link
          href="/dyeing"
          className="text-xs text-purple-600 hover:text-purple-800 font-medium"
        >
          Slip Module 1 &rarr;
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
        <button
          className={`flex-1 text-sm font-medium rounded-md py-2 transition ${
            tab === 'new' ? 'bg-white shadow text-purple-700' : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setTab('new')}
        >
          + New Slip
        </button>
        <button
          className={`flex-1 text-sm font-medium rounded-md py-2 transition ${
            tab === 'list' ? 'bg-white shadow text-purple-700' : 'text-gray-500 hover:text-gray-700'
          }`}
          onClick={() => setTab('list')}
        >
          Saved ({savedEntries.length})
        </button>
      </div>

      {/* ─── NEW SLIP TAB ─── */}
      {tab === 'new' && (
        <div className="space-y-4">
          {/* Alerts */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">
              {success}
            </div>
          )}

          {/* Step 1: Select Batch */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Step 1 — Select Fold Batch
            </h2>

            {batches.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">
                No fold batches found. Create a fold program first.
              </p>
            ) : (
              <div className="relative" ref={dropdownRef}>
                <div
                  className={`flex items-center gap-2 border rounded-lg px-3 py-2.5 bg-white cursor-pointer ${
                    dropdownOpen ? 'ring-2 ring-purple-400 border-purple-400' : 'border-gray-300'
                  }`}
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <span className={`flex-1 text-sm ${selectedBatch ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                    {selectedBatch
                      ? `Fold ${selectedBatch.foldNo} / Batch ${selectedBatch.batchNo} — ${selectedBatch.shadeName} (${selectedBatch.lots.map(l => l.lotNo).join(', ')}: ${selectedBatch.totalThan} than)`
                      : 'Select a batch...'}
                  </span>
                  {selectedBatch && (
                    <span className="text-purple-600 text-[10px] font-semibold bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded shrink-0">
                      {selectedBatch.totalWeight.toFixed(1)} kg
                    </span>
                  )}
                  <span className="text-gray-400 text-xs shrink-0">&#9660;</span>
                </div>

                {dropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-72 flex flex-col">
                    <input
                      type="text"
                      autoFocus
                      className="w-full border-b border-gray-200 px-3 py-2.5 text-sm focus:outline-none rounded-t-lg"
                      placeholder="Search by fold no, shade, lot..."
                      value={batchSearch}
                      onChange={e => setBatchSearch(e.target.value)}
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="overflow-y-auto max-h-56">
                      {filteredBatches.map(b => (
                        <button
                          key={b.batchId}
                          type="button"
                          className={`w-full text-left px-3 py-2.5 text-sm hover:bg-purple-50 border-b border-gray-50 ${
                            selectedBatchId === b.batchId ? 'bg-purple-50 font-medium' : ''
                          }`}
                          onClick={() => selectBatch(b.batchId)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-800">
                              {b.foldNo} / Batch {b.batchNo}
                            </span>
                            <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                              {b.totalWeight.toFixed(1)} kg
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500">{b.shadeName}</span>
                            <span className="text-xs text-gray-400">
                              ({b.lots.map(l => `${l.lotNo}: ${l.than}T`).join(', ')})
                            </span>
                          </div>
                        </button>
                      ))}
                      {filteredBatches.length === 0 && (
                        <p className="px-3 py-4 text-xs text-gray-400 text-center">No matching batches</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Auto-filled Details */}
          {selectedBatch && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">
                Step 2 — Batch Details
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                  {selectedBatch.shadeName}
                </span>
              </h2>

              {/* Lot Cards */}
              <div className="space-y-2 mb-4">
                {selectedBatch.lots.map((lot, i) => (
                  <div key={i} className="flex items-center justify-between border border-gray-200 rounded-xl p-3 bg-gray-50">
                    <div>
                      <span className="text-sm font-semibold text-gray-800">{lot.lotNo}</span>
                      <span className="ml-2 text-xs text-gray-400">{lot.than} than</span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">{lot.weightPerThan.toFixed(2)} kg/than</p>
                      <p className="text-sm font-semibold text-gray-700">
                        {(lot.weightPerThan * lot.than).toFixed(1)} kg
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Total weight card */}
              <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-gray-700">Total Batch Weight</span>
                <span className="text-lg font-bold text-purple-700">
                  {selectedBatch.totalWeight.toFixed(1)} kg
                </span>
              </div>
            </div>
          )}

          {/* Step 3: Chemicals */}
          {selectedBatch && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Step 3 — Chemicals
                  {chemicals.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-gray-400">{chemicals.length} items</span>
                  )}
                </h2>
                <button
                  type="button"
                  onClick={addChemicalRow}
                  className="text-xs text-purple-600 hover:text-purple-800 font-medium"
                >
                  + Add Chemical
                </button>
              </div>

              {/* Process Presets */}
              {processes.length > 0 && (
                <div className="mb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-gray-500 shrink-0">Process Presets:</span>
                    {processes.slice(0, showPresets ? processes.length : 4).map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          if (chemicals.length > 0 && !confirm(`Replace ${chemicals.length} chemical(s) with "${p.name}" preset?`)) return
                          applyPreset(p)
                        }}
                        title={p.description || `${p.items.length} chemicals`}
                        className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition shrink-0"
                      >
                        {p.name}
                        <span className="ml-1 text-indigo-400">({p.items.length})</span>
                      </button>
                    ))}
                    {processes.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setShowPresets(v => !v)}
                        className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                      >
                        {showPresets ? 'less' : `+${processes.length - 4} more`}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {chemicals.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">
                  No recipe found for this shade. Click &quot;+ Add Chemical&quot; to add manually.
                </p>
              ) : (
                <div className="space-y-3">
                  {chemicals.map((c, i) => (
                    <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                      {/* Chemical name row */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-400 w-5 shrink-0">#{i + 1}</span>
                        <div className="flex-1 relative">
                          <div
                            className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white cursor-pointer ${
                              chemDropIdx === i ? 'ring-2 ring-purple-400 border-purple-400' : 'border-gray-300'
                            }`}
                            onClick={() => { setChemDropIdx(chemDropIdx === i ? null : i); setChemSearch('') }}
                          >
                            <span className={`flex-1 text-sm ${c.name ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                              {c.name || 'Select chemical...'}
                            </span>
                            {c.chemicalId && (
                              <span className="text-green-600 text-[10px] font-semibold bg-green-50 border border-green-200 px-1 py-0.5 rounded shrink-0">
                                &#10003;
                              </span>
                            )}
                            <span className="text-gray-400 text-xs shrink-0">&#9660;</span>
                          </div>

                          {/* Chemical dropdown */}
                          {chemDropIdx === i && (
                            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 flex flex-col">
                              <input
                                type="text"
                                autoFocus
                                className="w-full border-b border-gray-200 px-3 py-2 text-sm focus:outline-none rounded-t-lg"
                                placeholder="Search chemical..."
                                value={chemSearch}
                                onChange={e => setChemSearch(e.target.value)}
                                onClick={e => e.stopPropagation()}
                              />
                              <div className="overflow-y-auto max-h-48">
                                {masterChemicals
                                  .filter(m => !chemSearch || m.name.toLowerCase().includes(chemSearch.toLowerCase()))
                                  .map(m => (
                                    <button
                                      key={m.id}
                                      type="button"
                                      className={`w-full text-left px-3 py-2 text-sm hover:bg-purple-50 flex items-center justify-between ${
                                        c.chemicalId === m.id ? 'bg-purple-50 font-medium' : ''
                                      }`}
                                      onClick={e => { e.stopPropagation(); selectMasterChemical(i, m) }}
                                    >
                                      <span>{m.name}</span>
                                      {m.currentPrice != null && (
                                        <span className="text-xs text-gray-400">
                                          &#8377;{m.currentPrice}/{m.unit}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                {chemSearch.trim() && !masterChemicals.some(m => m.name.toLowerCase() === chemSearch.toLowerCase()) && (
                                  <button
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 text-amber-700 border-t border-gray-100 flex items-center gap-1"
                                    onClick={e => {
                                      e.stopPropagation()
                                      updateChemical(i, 'name', chemSearch.trim())
                                      setChemDropIdx(null)
                                      setChemSearch('')
                                    }}
                                  >
                                    <span className="text-amber-500">+</span> Add &quot;{chemSearch.trim()}&quot; as new
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeChemical(i)}
                          className="text-red-400 hover:text-red-600 text-xl leading-none shrink-0 w-6 text-center"
                        >
                          &times;
                        </button>
                      </div>

                      {/* Qty / Unit / Rate / Cost */}
                      <div className="grid grid-cols-2 gap-2 pl-7">
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-0.5">Quantity</label>
                          <input
                            type="number"
                            step="0.001"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                            value={c.quantity}
                            onChange={e => updateChemical(i, 'quantity', e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-0.5">Unit</label>
                          <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white"
                            value={c.unit}
                            onChange={e => updateChemical(i, 'unit', e.target.value)}
                          >
                            {['kg', 'liter', 'gram', 'ml', 'piece', 'bag'].map(u => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-0.5">
                            Rate (&#8377;/{c.unit})
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                            value={c.rate}
                            onChange={e => updateChemical(i, 'rate', e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-0.5">Cost (&#8377;)</label>
                          <div
                            className={`w-full border rounded-lg px-3 py-1.5 text-sm font-semibold ${
                              c.cost != null
                                ? 'border-purple-200 bg-purple-50 text-purple-700'
                                : 'border-gray-200 bg-white text-gray-400'
                            }`}
                          >
                            {c.cost != null ? `\u20B9${c.cost.toFixed(2)}` : '\u2014'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Totals */}
                  {totalCost > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
                        <span className="text-sm font-semibold text-gray-700">Total Dyeing Cost</span>
                        <span className="text-lg font-bold text-purple-700">
                          &#8377;{totalCost.toFixed(2)}
                        </span>
                      </div>
                      {costPerThan > 0 && (
                        <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-2">
                          <span className="text-xs text-gray-500">Cost per Than</span>
                          <span className="text-sm font-semibold text-gray-700">
                            &#8377;{costPerThan.toFixed(2)} / than
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Save */}
          {selectedBatch && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Step 4 — Save</h2>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Slip No *</label>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    value={slipNo}
                    onChange={e => setSlipNo(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional notes..."
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBatchId(null)
                    setChemicals([])
                    setNotes('')
                    setError('')
                    setSuccess('')
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Dyeing Slip'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── LIST TAB ─── */}
      {tab === 'list' && (
        <div className="space-y-3">
          {savedEntries.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
              <p className="text-gray-400 text-sm">No batch dyeing slips saved yet.</p>
            </div>
          ) : (
            savedEntries.map(entry => {
              const entryTotalCost = entry.chemicals.reduce((s, c) => s + (c.cost ?? 0), 0)
              const foldNo = entry.foldBatch?.foldProgram?.foldNo ?? '?'
              const batchNo = entry.foldBatch?.batchNo ?? '?'
              const shade = entry.foldBatch?.shade?.name ?? ''
              const lots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo ?? '', than: entry.than }] as any[]

              return (
                <div key={entry.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-800">Slip #{entry.slipNo}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(entry.date).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                    {shade && (
                      <span className="text-[10px] font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                        {shade}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 mb-2">
                    Fold {foldNo} / Batch {batchNo}
                    {' \u2022 '}
                    {lots.map((l: any) => `${l.lotNo} (${l.than}T)`).join(', ')}
                  </div>

                  {entry.chemicals.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {entry.chemicals.slice(0, 4).map((ch, ci) => (
                        <span key={ci} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {ch.name} {ch.quantity != null ? `${ch.quantity}${ch.unit}` : ''}
                        </span>
                      ))}
                      {entry.chemicals.length > 4 && (
                        <span className="text-[10px] text-gray-400">+{entry.chemicals.length - 4} more</span>
                      )}
                    </div>
                  )}

                  {entryTotalCost > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Total Cost</span>
                      <span className="text-sm font-semibold text-purple-700">
                        &#8377;{entryTotalCost.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {entry.notes && (
                    <p className="text-xs text-gray-400 mt-1 italic">{entry.notes}</p>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
