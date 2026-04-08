'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BackButton from '../../BackButton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LotInfo {
  lotNo: string
  than: number
  weightPerThan: number
  quality?: string
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
  foldDate?: string
  foldProgramId: number
  batchNo: number
  batchId: number
  shadeName: string
  shadeDescription?: string | null
  shadeId: number | null
  lots: LotInfo[]
  totalThan: number
  totalWeight: number
  recipe: RecipeItem[]
  isPcJob?: boolean
  marka?: string | null
}

interface FoldGroup {
  foldNo: string
  foldDate: string
  batches: BatchInfo[]
  allLots: string[]
  totalThan: number
  qualities: string[]
}

interface ChemicalRow {
  chemicalId: number | null
  name: string
  quantity: string
  unit: string
  rate: string
  cost: number | null
  processTag: string | null
}

interface MachineOption { id: number; number: number; name: string; isActive: boolean }
interface OperatorOption { id: number; name: string; mobileNo: string | null; isActive: boolean }

interface ChemicalMaster {
  id: number
  name: string
  unit: string
  currentPrice: number | null
}

interface DyeingProcessItem { chemicalId: number; quantity: number; quantityHigh?: number | null; chemical: { id: number; name: string; unit: string } }
interface DyeingProcess { id: number; name: string; description?: string; threshold?: number; items: DyeingProcessItem[] }

interface SavedEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  notes: string | null
  shadeName?: string | null
  isPcJob?: boolean
  marka?: string | null
  foldBatch?: {
    batchNo: number
    marka?: string | null
    foldProgram?: { foldNo: string; isPcJob?: boolean }
    shade?: { name: string; description?: string | null }
  } | null
  machine?: { name: string } | null
  operator?: { name: string } | null
  chemicals: { name: string; quantity: number | null; unit: string; cost: number | null }[]
  lots: { lotNo: string; than: number }[]
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BatchDyeingPage() {
  const router = useRouter()
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const autoFoldId = searchParams?.get('foldId') || null

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
  const [expandedFold, setExpandedFold] = useState<string | null>(null)

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

  // Saved tab search/sort
  const [savedSearch, setSavedSearch] = useState('')
  const [savedSort, setSavedSort] = useState<'slip-desc' | 'slip-asc' | 'date-desc' | 'date-asc' | 'party' | 'lot'>('slip-desc')

  // Chemical dropdown state
  const [chemDropIdx, setChemDropIdx] = useState<number | null>(null)
  const [chemSearch, setChemSearch] = useState('')

  // Process presets
  const [processes, setProcesses] = useState<DyeingProcess[]>([])
  const [processPopup, setProcessPopup] = useState<DyeingProcess | null>(null)
  const [processQtys, setProcessQtys] = useState<Record<number, string>>({})

  // Machine & Operator
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [operators, setOperators] = useState<OperatorOption[]>([])
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null)
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null)

  // ─── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch('/api/dyeing/batches').then(r => r.json()),
      fetch('/api/dyeing/batch').then(r => r.json()),
      fetch('/api/chemicals').then(r => r.json()).catch(() => []),
      fetch('/api/dyeing/processes').then(r => r.json()).catch(() => []),
      fetch('/api/dyeing/machines').then(r => r.json()).catch(() => []),
      fetch('/api/dyeing/operators?active=true').then(r => r.json()).catch(() => []),
    ]).then(([batchData, entryData, chemData, processData, machineData, operatorData]) => {
      const batchList = Array.isArray(batchData) ? batchData : []
      setBatches(batchList)
      setSavedEntries(Array.isArray(entryData) ? entryData : [])
      setMasterChemicals(Array.isArray(chemData) ? chemData : [])
      setProcesses(Array.isArray(processData) ? processData : [])
      setMachines(Array.isArray(machineData) ? machineData.filter((m: any) => m.isActive) : [])
      setOperators(Array.isArray(operatorData) ? operatorData : [])
      setLoading(false)

      // Auto-select first batch from fold if foldId in URL
      if (autoFoldId && batchList.length > 0) {
        const foldBatch = batchList.find((b: any) => String(b.foldProgramId) === autoFoldId)
        if (foldBatch) {
          setSelectedBatchId(foldBatch.batchId)
        }
      }
    }).catch(() => setLoading(false))
  }, [])

  // Auto-generate next slip number from ALL dyeing entries (shared series)
  useEffect(() => {
    if (!slipNo) {
      // Fetch max slip no from all dyeing entries
      fetch('/api/dyeing?maxSlipNo=true')
        .then(r => r.json())
        .then(data => {
          const maxFromAll = data.maxSlipNo ?? 0
          const maxFromSaved = savedEntries.length > 0 ? Math.max(...savedEntries.map(e => e.slipNo), 0) : 0
          const nextSlip = Math.max(maxFromAll, maxFromSaved) + 1
          setSlipNo(String(nextSlip))
        })
        .catch(() => {
          const maxSlip = savedEntries.length > 0 ? Math.max(...savedEntries.map(e => e.slipNo), 0) : 0
          setSlipNo(String(maxSlip + 1))
        })
    }
  }, [savedEntries]) // eslint-disable-line react-hooks/exhaustive-deps

  // Group batches by fold number
  const foldGroups = useMemo(() => {
    const q = batchSearch.toLowerCase()
    const filtered = batches.filter(b => {
      if (!q) return true
      const str = `${b.foldNo} ${b.shadeName} ${b.lots.map(l => `${l.lotNo} ${l.quality ?? ''}`).join(' ')}`.toLowerCase()
      return str.includes(q)
    })
    const map = new Map<string, FoldGroup>()
    for (const b of filtered) {
      if (!map.has(b.foldNo)) {
        map.set(b.foldNo, { foldNo: b.foldNo, foldDate: b.foldDate ?? '', batches: [], allLots: [], totalThan: 0, qualities: [] })
      }
      const g = map.get(b.foldNo)!
      g.batches.push(b)
      for (const l of b.lots) {
        g.allLots.push(l.lotNo)
        g.totalThan += l.than
        if (l.quality && !g.qualities.includes(l.quality)) g.qualities.push(l.quality)
      }
    }
    return Array.from(map.values()).sort((a, b) => parseInt(b.foldNo) - parseInt(a.foldNo) || b.foldNo.localeCompare(a.foldNo))
  }, [batches, batchSearch])

  // ─── Selected batch ─────────────────────────────────────────────────────────

  const selectedBatch = useMemo(
    () => batches.find(b => b.batchId === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  )

  // When batch selected, populate chemicals from recipe
  function selectBatch(batchId: number) {
    setSelectedBatchId(batchId)
    setBatchSearch('')
    setError('')
    setSuccess('')

    const batch = batches.find(b => b.batchId === batchId)
    if (batch) {
      setChemicals(
        batch.recipe.map(r => ({
          chemicalId: r.chemicalId,
          name: r.chemicalName,
          quantity: r.calculatedQty.toFixed(3),
          unit: r.unit,
          rate: r.rate != null ? String(r.rate) : '',
          cost: r.rate != null ? Math.round(r.calculatedQty * r.rate * 1000) / 1000 : null,
          processTag: 'shade',
        }))
      )
    }
  }

  // ─── Filtered batches for dropdown ──────────────────────────────────────────

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
      { chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null, processTag: null },
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
    // Remove existing chemicals from this process, then add fresh
    const withoutOld = chemicals.filter(c => c.processTag !== process.name)
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
        processTag: process.name,
      }
    })
    setChemicals([...withoutOld, ...rows])
  }

  // Open process popup instead of directly applying
  function openProcessPopup(process: DyeingProcess) {
    const threshold = process.threshold ?? 220
    const batchWeight = selectedBatch?.totalWeight ?? 0
    const useHigh = batchWeight > threshold
    const qtys: Record<number, string> = {}
    process.items.forEach(item => {
      const qty = useHigh && item.quantityHigh != null ? item.quantityHigh : item.quantity
      qtys[item.chemicalId] = String(qty)
    })
    setProcessQtys(qtys)
    setProcessPopup(process)
  }

  function confirmProcessPopup() {
    if (!processPopup) return
    const withoutOld = chemicals.filter(c => c.processTag !== processPopup.name)
    const rows: ChemicalRow[] = processPopup.items.map(item => {
      const master = masterChemicals.find(m => m.id === item.chemicalId)
      const rate = master?.currentPrice != null ? String(master.currentPrice) : ''
      const qty = processQtys[item.chemicalId] || String(item.quantity)
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
        processTag: processPopup.name,
      }
    })
    setChemicals([...withoutOld, ...rows])
    setProcessPopup(null)
  }

  // Check if a process is already added
  function isProcessAdded(processName: string): boolean {
    return chemicals.some(c => c.processTag === processName)
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

    // Duplicate slip number check
    const slipNum = parseInt(slipNo)
    if (savedEntries.some(e => e.slipNo === slipNum)) {
      setError(`Slip No ${slipNum} already exists. Use a different number.`); return
    }

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
          machineId: selectedMachineId,
          operatorId: selectedOperatorId,
          lots: selectedBatch.lots.map(l => ({ lotNo: l.lotNo, than: l.than })),
          notes: notes.trim() || null,
          shadeName: selectedBatch.shadeName || null,
          isPcJob: selectedBatch.isPcJob || false,
          marka: selectedBatch.marka || null,
          chemicals: chemicals.map(c => ({
            chemicalId: c.chemicalId,
            name: c.name,
            quantity: c.quantity ? parseFloat(c.quantity) : null,
            unit: c.unit,
            rate: c.rate ? parseFloat(c.rate) : null,
            cost: c.cost,
            processTag: c.processTag || null,
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

      // Remove used batch from dropdown list
      const usedBatchId = selectedBatch.batchId
      setBatches(prev => prev.filter(b => b.batchId !== usedBatchId))

      // Reset form
      setSelectedBatchId(null)
      setChemicals([])
      setNotes('')
      setSelectedMachineId(null)
      setSelectedOperatorId(null)
      setSlipNo(String(saved.slipNo + 1))
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
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Dyeing Slip (Batch)</h1>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Create dyeing slips from fold program batches</p>
          </div>
        </div>
        <Link
          href="/dyeing"
          className="text-xs text-purple-600 hover:text-purple-800 font-medium"
        >
          Slip Module 1 &rarr;
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 mb-4">
        <button
          className={`flex-1 text-sm font-medium rounded-md py-2 transition ${
            tab === 'new' ? 'bg-white dark:bg-gray-700 shadow text-purple-700' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
          onClick={() => setTab('new')}
        >
          + New Slip
        </button>
        <button
          className={`flex-1 text-sm font-medium rounded-md py-2 transition ${
            tab === 'list' ? 'bg-white dark:bg-gray-700 shadow text-purple-700' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">
              {success}
            </div>
          )}

          {/* Step 1: Select Fold Batch */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
              Step 1 — Select Fold Batch
            </h2>

            {/* Selected batch compact card */}
            {selectedBatch && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3 mb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-green-700 dark:text-green-400">
                      ✅ Fold {selectedBatch.foldNo} / B{selectedBatch.batchNo}
                    </span>
                    <span className="ml-2 text-xs text-green-600 dark:text-green-500">{selectedBatch.shadeName}{selectedBatch.shadeDescription && ` — ${selectedBatch.shadeDescription}`}</span>
                  </div>
                  <button onClick={() => { setSelectedBatchId(null); setChemicals([]); setExpandedFold(null) }}
                    className="text-xs text-green-600 dark:text-green-400 hover:text-green-800 border border-green-300 dark:border-green-700 rounded-lg px-2 py-1">
                    Change ✏️
                  </button>
                </div>
                <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                  {selectedBatch.lots.map(l => `${l.lotNo} (${l.than}T)`).join(', ')} · {selectedBatch.totalWeight.toFixed(1)} kg
                </p>
              </div>
            )}

            {/* Fold cards (hidden when batch selected) */}
            {!selectedBatch && (
              <>
                <input
                  type="text"
                  placeholder="Search fold no, shade, lot, quality..."
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={batchSearch}
                  onChange={e => setBatchSearch(e.target.value)}
                />

                {foldGroups.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
                    {batches.length === 0 ? 'No fold batches found. Create a fold program first.' : 'No matching batches.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {foldGroups.map(fg => {
                      const isExpanded = expandedFold === fg.foldNo
                      return (
                        <div key={fg.foldNo} className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
                          {/* Fold header — clickable */}
                          <button
                            type="button"
                            onClick={() => setExpandedFold(isExpanded ? null : fg.foldNo)}
                            className="w-full text-left px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Fold {fg.foldNo}</span>
                                <span className="text-[10px] text-gray-400">
                                  {fg.foldDate ? new Date(fg.foldDate).toLocaleDateString('en-IN') : ''}
                                </span>
                                <span className="text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-full">
                                  {fg.batches.length} pending
                                </span>
                              </div>
                              <span className="text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                            </div>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 truncate">
                              {fg.allLots.join(', ')} · {fg.totalThan} than
                              {fg.qualities.length > 0 && ` · ${fg.qualities.join(', ')}`}
                            </p>
                          </button>

                          {/* Expanded — batch cards */}
                          {isExpanded && (
                            <div className="p-2 space-y-2 bg-white dark:bg-gray-800">
                              {fg.batches.map(b => (
                                <div key={b.batchId}
                                  className="border border-gray-200 dark:border-gray-600 rounded-xl p-3 hover:border-purple-300 dark:hover:border-purple-600 transition">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div>
                                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">B{b.batchNo}</span>
                                      <span className="ml-2 text-xs text-purple-600 dark:text-purple-400 font-medium">{b.shadeName}{b.shadeDescription && ` — ${b.shadeDescription}`}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => selectBatch(b.batchId)}
                                      className="bg-purple-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-purple-700 transition"
                                    >
                                      Select →
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {b.lots.map((l, li) => (
                                      <span key={li} className="text-[10px] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-full font-medium">
                                        {l.lotNo} ({l.than}T)
                                      </span>
                                    ))}
                                    <span className="text-[10px] text-gray-400 ml-auto">{b.totalWeight.toFixed(1)} kg</span>
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
              </>
            )}
          </div>

          {/* Step 2: Auto-filled Details */}
          {selectedBatch && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
                Step 2 — Batch Details
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                  {selectedBatch.shadeName}{selectedBatch.shadeDescription && ` — ${selectedBatch.shadeDescription}`}
                </span>
              </h2>

              {/* Lot Cards */}
              <div className="space-y-2 mb-4">
                {selectedBatch.lots.map((lot, i) => (
                  <div key={i} className="flex items-center justify-between border border-gray-200 dark:border-gray-600 rounded-xl p-3 bg-gray-50 dark:bg-gray-900">
                    <div>
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{lot.lotNo}</span>
                      <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{lot.than} than</span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500 dark:text-gray-400">{lot.weightPerThan.toFixed(2)} kg/than</p>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        {(lot.weightPerThan * lot.than).toFixed(1)} kg
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Total weight card */}
              <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 border border-purple-200 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Total Batch Weight</span>
                <span className="text-lg font-bold text-purple-700">
                  {selectedBatch.totalWeight.toFixed(1)} kg
                </span>
              </div>

              {/* Machine & Operator */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Machine</label>
                  <select
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={selectedMachineId ?? ''}
                    onChange={e => setSelectedMachineId(e.target.value ? parseInt(e.target.value) : null)}
                  >
                    <option value="">-- Select --</option>
                    {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Operator</label>
                  <select
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={selectedOperatorId ?? ''}
                    onChange={e => setSelectedOperatorId(e.target.value ? parseInt(e.target.value) : null)}
                  >
                    <option value="">-- Select --</option>
                    {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Process Buttons — above chemicals */}
          {selectedBatch && processes.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Add Process (Auxiliary)</h2>
              <div className="flex flex-wrap gap-2">
                {processes.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openProcessPopup(p)}
                    title={p.description || `${p.items.length} chemicals`}
                    className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${
                      isProcessAdded(p.name)
                        ? 'bg-green-900/30 text-green-400 border-green-700'
                        : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
                    }`}
                  >
                    {isProcessAdded(p.name) ? '✅ ' : '🧪 '}{p.name}
                    <span className="ml-1 opacity-60 text-xs">({p.items.length})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Chemicals */}
          {selectedBatch && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Step 3 — Chemicals
                  {chemicals.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">{chemicals.length} items</span>
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

              {chemicals.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
                  No recipe found for this shade. Click &quot;+ Add Chemical&quot; to add manually.
                </p>
              ) : (
                <div className="space-y-3">
                  {chemicals.map((c, i) => (
                    <div key={i} className="border border-gray-200 dark:border-gray-600 rounded-xl p-3 bg-gray-50 dark:bg-gray-900">
                      {/* Chemical name row */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-400 dark:text-gray-500 w-5 shrink-0">#{i + 1}</span>
                        <div className="flex-1 relative">
                          <div
                            className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white dark:bg-gray-700 cursor-pointer ${
                              chemDropIdx === i ? 'ring-2 ring-purple-400 border-purple-400' : 'border-gray-300 dark:border-gray-600'
                            }`}
                            onClick={() => { setChemDropIdx(chemDropIdx === i ? null : i); setChemSearch('') }}
                          >
                            <span className={`flex-1 text-sm ${c.name ? 'font-medium text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
                              {c.name || 'Select chemical...'}
                            </span>
                            {c.chemicalId && (
                              <span className="text-green-600 text-[10px] font-semibold bg-green-50 border border-green-200 px-1 py-0.5 rounded shrink-0">
                                &#10003;
                              </span>
                            )}
                            <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0">&#9660;</span>
                          </div>

                          {/* Chemical dropdown */}
                          {chemDropIdx === i && (
                            <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-60 flex flex-col">
                              <input
                                type="text"
                                autoFocus
                                className="w-full border-b border-gray-200 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none rounded-t-lg dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
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
                                      className={`w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/20 dark:text-gray-200 flex items-center justify-between ${
                                        c.chemicalId === m.id ? 'bg-purple-50 dark:bg-purple-900/20 font-medium' : ''
                                      }`}
                                      onClick={e => { e.stopPropagation(); selectMasterChemical(i, m) }}
                                    >
                                      <span>{m.name}</span>
                                      {m.currentPrice != null && (
                                        <span className="text-xs text-gray-400 dark:text-gray-500">
                                          &#8377;{m.currentPrice}/{m.unit}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                {chemSearch.trim() && !masterChemicals.some(m => m.name.toLowerCase() === chemSearch.toLowerCase()) && (
                                  <button
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-700 border-t border-gray-100 dark:border-gray-700 flex items-center gap-1"
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

                      {/* Process tag badge */}
                      {c.processTag && (
                        <div className="ml-7 mb-1">
                          <span className="text-[10px] font-medium bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">{c.processTag}</span>
                        </div>
                      )}

                      {/* Qty / Unit / Rate / Cost */}
                      <div className="grid grid-cols-2 gap-2 pl-7">
                        <div>
                          <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Quantity</label>
                          <input
                            type="number"
                            step="0.001"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:placeholder-gray-400"
                            value={c.quantity}
                            onChange={e => updateChemical(i, 'quantity', e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Unit</label>
                          <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
                            value={c.unit}
                            onChange={e => updateChemical(i, 'unit', e.target.value)}
                          >
                            {['kg', 'liter', 'gram', 'ml', 'piece', 'bag'].map(u => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">
                            Rate (&#8377;/{c.unit})
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:placeholder-gray-400"
                            value={c.rate}
                            onChange={e => updateChemical(i, 'rate', e.target.value)}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Cost (&#8377;)</label>
                          <div
                            className={`w-full border rounded-lg px-3 py-1.5 text-sm font-semibold ${
                              c.cost != null
                                ? 'border-purple-200 bg-purple-50 dark:bg-purple-900/20 text-purple-700'
                                : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-400 dark:text-gray-500'
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
                      <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 border border-purple-200 rounded-xl px-4 py-3">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Total Dyeing Cost</span>
                        <span className="text-lg font-bold text-purple-700">
                          &#8377;{totalCost.toFixed(2)}
                        </span>
                      </div>
                      {costPerThan > 0 && (
                        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">Cost per Than</span>
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
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
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Step 4 — Save</h2>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Slip No *</label>
                  <input
                    type="number"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:placeholder-gray-400"
                    value={slipNo}
                    onChange={e => setSlipNo(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date *</label>
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:placeholder-gray-400"
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
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
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
      {tab === 'list' && (() => {
        const sq = savedSearch.toLowerCase()
        const filteredSaved = savedEntries.filter(e => {
          if (!sq) return true
          const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo ?? '', than: e.than }]
          const shade = e.foldBatch?.shade?.name ?? e.shadeName ?? ''
          const party = lots.map((l: any) => l.lotNo).join(' ')
          const foldNo = e.foldBatch?.foldProgram?.foldNo ?? ''
          const machName = e.machine?.name ?? ''
          const opName = e.operator?.name ?? ''
          const searchStr = `${e.slipNo} ${shade} ${party} ${foldNo} ${machName} ${opName}`.toLowerCase()
          return searchStr.includes(sq)
        }).sort((a, b) => {
          switch (savedSort) {
            case 'slip-desc': return b.slipNo - a.slipNo
            case 'slip-asc': return a.slipNo - b.slipNo
            case 'date-desc': return new Date(b.date).getTime() - new Date(a.date).getTime()
            case 'date-asc': return new Date(a.date).getTime() - new Date(b.date).getTime()
            case 'party': {
              const pa = (a.lots?.[0]?.lotNo ?? a.lotNo ?? '').toLowerCase()
              const pb = (b.lots?.[0]?.lotNo ?? b.lotNo ?? '').toLowerCase()
              return pa.localeCompare(pb)
            }
            case 'lot': {
              const la = a.lots?.[0]?.lotNo ?? a.lotNo ?? ''
              const lb = b.lots?.[0]?.lotNo ?? b.lotNo ?? ''
              const ma = la.match(/(\d+)$/), mb = lb.match(/(\d+)$/)
              return (ma ? parseInt(ma[1]) : 0) - (mb ? parseInt(mb[1]) : 0)
            }
            default: return 0
          }
        })

        return (
          <div className="space-y-3">
            {/* Search */}
            <input
              type="text"
              placeholder="Search slip no, lot, shade, fold..."
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              value={savedSearch}
              onChange={e => setSavedSearch(e.target.value)}
            />
            {/* Sort */}
            <div className="flex gap-1.5 flex-wrap items-center">
              <span className="text-[10px] text-gray-500">Sort:</span>
              {([
                ['slip-desc', 'Slip ↓'], ['slip-asc', 'Slip ↑'], ['date-desc', 'Date ↓'], ['date-asc', 'Date ↑'], ['lot', 'Lot'], ['party', 'Party'],
              ] as [typeof savedSort, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setSavedSort(key)}
                  className={`text-[10px] px-2 py-0.5 rounded border ${savedSort === key ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
                  {label}
                </button>
              ))}
              <span className="text-[10px] text-gray-400 ml-auto">{filteredSaved.length} of {savedEntries.length}</span>
            </div>

            {filteredSaved.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-8 text-center">
                <p className="text-gray-400 dark:text-gray-500 text-sm">{savedEntries.length === 0 ? 'No batch dyeing slips saved yet.' : 'No matching slips found.'}</p>
              </div>
            ) : (
              filteredSaved.map(entry => {
                const foldNo = entry.foldBatch?.foldProgram?.foldNo ?? '?'
                const batchNo = entry.foldBatch?.batchNo ?? '?'
                const shade = entry.foldBatch?.shade?.name ?? entry.shadeName ?? ''
                const shadeDesc = entry.foldBatch?.shade?.description ?? null
                const lots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo ?? '', than: entry.than }] as any[]

                return (
                  <div key={entry.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <Link href={`/dyeing/${entry.id}`} className="text-sm font-bold text-purple-600 dark:text-purple-400 hover:underline">
                          Slip {entry.slipNo}
                        </Link>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(entry.date).toLocaleDateString('en-IN')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {shade && (
                          <span className="text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                            {shade}{shadeDesc && ` — ${shadeDesc}`}
                          </span>
                        )}
                        <Link href={`/dyeing/${entry.id}/print`} target="_blank" className="text-gray-400 hover:text-purple-400 text-sm">🖨️</Link>
                      </div>
                    </div>

                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 flex items-center gap-1.5 flex-wrap">
                      {(entry.isPcJob || entry.foldBatch?.foldProgram?.isPcJob) && (
                        <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">PC</span>
                      )}
                      <span>Fold {foldNo} / Batch {batchNo}</span>
                      {(entry.marka || entry.foldBatch?.marka) && (
                        <span className="text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                          {entry.marka || entry.foldBatch?.marka}
                        </span>
                      )}
                      {entry.machine && <span>· {entry.machine.name}</span>}
                      {entry.operator && <span>· {entry.operator.name}</span>}
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {lots.map((l: any, li: number) => (
                        <span key={li} className="text-[10px] font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-full">
                          {l.lotNo} ({l.than}T)
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-gray-400">{entry.chemicals.length} chemicals</span>
                      {entry.chemicals.reduce((s, c) => s + (c.cost ?? 0), 0) > 0 && (
                        <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                          ₹{entry.chemicals.reduce((s, c) => s + (c.cost ?? 0), 0).toFixed(0)}
                        </span>
                      )}
                      {entry.notes && <span className="text-[10px] text-gray-400 italic truncate max-w-[150px]">{entry.notes}</span>}
                      {(entry as any).status === 'patchy' && (
                        <span className="text-[10px] text-red-400 bg-red-900/20 border border-red-800 px-1.5 py-0.5 rounded-full font-medium">Patchy</span>
                      )}
                      {(entry as any).status === 're-dyeing' && (
                        <span className="text-[10px] text-amber-400 bg-amber-900/20 border border-amber-800 px-1.5 py-0.5 rounded-full font-medium">Re-dyeing</span>
                      )}
                      {(entry as any).status === 'done' && (
                        <span className="text-[10px] text-green-400 bg-green-900/20 border border-green-800 px-1.5 py-0.5 rounded-full font-medium">Done</span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )
      })()}
      {/* Process Popup Modal */}
      {processPopup && (() => {
        const threshold = processPopup.threshold ?? 220
        const batchWeight = selectedBatch?.totalWeight ?? 0
        const useHigh = batchWeight > threshold
        const hasHighPreset = processPopup.items.some(i => i.quantityHigh != null)
        return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setProcessPopup(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{processPopup.name}</h3>
              <button onClick={() => setProcessPopup(null)} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>
            {hasHighPreset && batchWeight > 0 && (
              <div className={`text-xs px-2 py-1 rounded mb-3 ${useHigh ? 'bg-orange-900/30 text-orange-400' : 'bg-purple-900/30 text-purple-400'}`}>
                {useHigh
                  ? `> ${threshold} kg preset (batch: ${batchWeight.toFixed(1)} kg)`
                  : `\u2264 ${threshold} kg preset (batch: ${batchWeight.toFixed(1)} kg)`}
              </div>
            )}
            <div className="space-y-3">
              {processPopup.items.map(item => (
                <div key={item.chemicalId} className="flex items-center gap-3 border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-gray-900">
                  <span className="flex-1 text-sm text-gray-800 dark:text-gray-100">{item.chemical.name}</span>
                  <input
                    type="number"
                    step="0.1"
                    className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-center bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    value={processQtys[item.chemicalId] ?? String(item.quantity)}
                    onChange={e => setProcessQtys(prev => ({ ...prev, [item.chemicalId]: e.target.value }))}
                  />
                  <span className="text-xs text-gray-400 w-6">{item.chemical.unit}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={confirmProcessPopup}
              className="mt-4 w-full bg-green-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition"
            >
              Add to Slip
            </button>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
