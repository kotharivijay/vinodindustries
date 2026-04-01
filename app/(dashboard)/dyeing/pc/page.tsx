'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BackButton from '../../BackButton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PartyOption { id: number; name: string; tag?: string | null }
interface MarkaGroup { marka: string; lots: { lotNo: string; greyThan: number; availableThan: number }[] }
interface MachineOption { id: number; number?: number; name: string; isActive: boolean }
interface OperatorOption { id: number; name: string; mobileNo?: string | null; isActive: boolean }
interface ShadeOption { id: number; name: string }
interface ChemicalMaster { id: number; name: string; unit: string; currentPrice: number | null }
interface DyeingProcessItem { chemicalId: number; quantity: number; chemical: { id: number; name: string; unit: string } }
interface DyeingProcess { id: number; name: string; description?: string; items: DyeingProcessItem[] }

interface ChemicalRow {
  chemicalId: number | null
  name: string
  quantity: string
  unit: string
  rate: string
  cost: number | null
  processTag: string | null
}

interface LotSelection {
  lotNo: string
  greyThan: number
  availableThan: number
  selected: boolean
  than: string
}

interface ConfirmedFoldBatch {
  id: number
  batchNo: number
  marka: string | null
  shadeName: string | null
  shade: { name: string } | null
  lots: { lotNo: string; than: number; party?: { name: string } | null }[]
  foldNo: string
  foldProgramId: number
}

interface SavedEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  marka: string | null
  partyInstructions: string | null
  shadeName: string | null
  notes: string | null
  status: string
  totalRounds: number
  dyeingDoneAt: string | null
  dyeingPhotoUrl: string | null
  machine: { id: number; name: string } | null
  operator: { id: number; name: string } | null
  chemicals: { name: string; quantity: number | null; unit: string; cost: number | null; processTag?: string | null }[]
  lots: { lotNo: string; than: number }[]
  partyName: string | null
  additions: any[]
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PcDyeingPage() {
  const router = useRouter()

  // Tab state
  const [tab, setTab] = useState<'new' | 'saved'>('new')
  const [step, setStep] = useState(1)

  // Master data
  const [parties, setParties] = useState<PartyOption[]>([])
  const [markas, setMarkas] = useState<MarkaGroup[]>([])
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [operators, setOperators] = useState<OperatorOption[]>([])
  const [shades, setShades] = useState<ShadeOption[]>([])
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])
  const [processes, setProcesses] = useState<DyeingProcess[]>([])
  const [savedEntries, setSavedEntries] = useState<SavedEntry[]>([])

  // Confirmed fold batches
  const [confirmedFoldBatches, setConfirmedFoldBatches] = useState<ConfirmedFoldBatch[]>([])
  const [selectedFoldBatchId, setSelectedFoldBatchId] = useState<number | null>(null)

  // Step 1 fields
  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null)
  const [selectedMarka, setSelectedMarka] = useState('')
  const [lotSelections, setLotSelections] = useState<LotSelection[]>([])
  const [loadingMarkas, setLoadingMarkas] = useState(false)

  // Step 2 fields
  const [slipNo, setSlipNo] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null)
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null)
  const [shadeName, setShadeName] = useState('')
  const [newShadeName, setNewShadeName] = useState('')
  const [showNewShade, setShowNewShade] = useState(false)
  const [partyInstructions, setPartyInstructions] = useState('')

  // Step 3 - Chemicals
  const [chemicals, setChemicals] = useState<ChemicalRow[]>([])
  const [chemDropIdx, setChemDropIdx] = useState<number | null>(null)
  const [chemSearch, setChemSearch] = useState('')
  const [processPopup, setProcessPopup] = useState<DyeingProcess | null>(null)
  const [processQtys, setProcessQtys] = useState<Record<number, string>>({})

  // General state
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Saved tab
  const [savedSearch, setSavedSearch] = useState('')
  const [savedSort, setSavedSort] = useState<'date' | 'slip' | 'party' | 'marka'>('date')

  // Confirm done modal
  const [confirmEntry, setConfirmEntry] = useState<SavedEntry | null>(null)
  const [confirmPhoto, setConfirmPhoto] = useState<{base64: string; mediaType: string} | null>(null)
  const [confirmDate, setConfirmDate] = useState(new Date().toISOString().slice(0, 10))
  const [confirmNotes, setConfirmNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const confirmCameraRef = useRef<HTMLInputElement>(null)

  // Addition modal
  const [additionEntry, setAdditionEntry] = useState<SavedEntry | null>(null)
  const [addChemRows, setAddChemRows] = useState<{chemicalId: number | null; name: string; quantity: string; unit: string; rate: string; cost: number | null}[]>([])
  const [addReason, setAddReason] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addChemDrop, setAddChemDrop] = useState<number | null>(null)
  const [addChemSearch, setAddChemSearch] = useState('')

  // Re-dye modal
  const [reDyeEntry, setReDyeEntry] = useState<SavedEntry | null>(null)
  const [reDyeDefect, setReDyeDefect] = useState('')
  const [reDyeMachineId, setReDyeMachineId] = useState<number | null>(null)
  const [reDyeOperatorId, setReDyeOperatorId] = useState<number | null>(null)
  const [reDyeReason, setReDyeReason] = useState('')
  const [reDyeChemRows, setReDyeChemRows] = useState<{chemicalId: number | null; name: string; quantity: string; unit: string; rate: string; cost: number | null}[]>([])
  const [reDyeSaving, setReDyeSaving] = useState(false)
  const [reDyeChemDrop, setReDyeChemDrop] = useState<number | null>(null)
  const [reDyeChemSearch, setReDyeChemSearch] = useState('')

  // ─── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch('/api/masters/parties').then(r => r.json()),
      fetch('/api/dyeing/pc').then(r => r.json()),
      fetch('/api/chemicals').then(r => r.json()).catch(() => []),
      fetch('/api/dyeing/machines').then(r => r.json()).catch(() => []),
      fetch('/api/dyeing/operators?active=true').then(r => r.json()).catch(() => []),
      fetch('/api/shades').then(r => r.json()).catch(() => []),
      fetch('/api/dyeing/processes').then(r => r.json()).catch(() => []),
      fetch('/api/fold/pc').then(r => r.json()).catch(() => []),
    ]).then(([partyData, entryData, chemData, machineData, operatorData, shadeData, processData, foldData]) => {
      const pcParties = (Array.isArray(partyData) ? partyData : []).filter((p: PartyOption) => p.tag === 'Pali PC Job')
      setParties(pcParties)
      setSavedEntries(Array.isArray(entryData) ? entryData : [])
      setMasterChemicals(Array.isArray(chemData) ? chemData : [])
      setMachines(Array.isArray(machineData) ? machineData.filter((m: any) => m.isActive) : [])
      setOperators(Array.isArray(operatorData) ? operatorData : [])
      setShades(Array.isArray(shadeData) ? shadeData : [])
      setProcesses(Array.isArray(processData) ? processData : [])
      // Extract confirmed fold batches
      const confirmedFolds = (Array.isArray(foldData) ? foldData : []).filter((f: any) => f.isPcJob && f.confirmedAt)
      const cfBatches: ConfirmedFoldBatch[] = []
      for (const fold of confirmedFolds) {
        for (const batch of fold.batches ?? []) {
          cfBatches.push({
            id: batch.id,
            batchNo: batch.batchNo,
            marka: batch.marka ?? null,
            shadeName: batch.shadeName ?? null,
            shade: batch.shade ?? null,
            lots: batch.lots ?? [],
            foldNo: fold.foldNo,
            foldProgramId: fold.id,
          })
        }
      }
      setConfirmedFoldBatches(cfBatches)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // Auto-generate next slip number from ALL dyeing entries
  useEffect(() => {
    if (!slipNo) {
      fetch('/api/dyeing').then(r => r.json()).then((allEntries: any[]) => {
        if (Array.isArray(allEntries) && allEntries.length > 0) {
          const maxSlip = Math.max(...allEntries.map((e: any) => e.slipNo), 0)
          setSlipNo(String(maxSlip + 1))
        } else {
          setSlipNo('1')
        }
      }).catch(() => setSlipNo('1'))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load markas when party changes
  useEffect(() => {
    if (!selectedPartyId) { setMarkas([]); return }
    setLoadingMarkas(true)
    fetch(`/api/dyeing/pc/markas?partyId=${selectedPartyId}`)
      .then(r => r.json())
      .then(data => {
        setMarkas(Array.isArray(data) ? data : [])
        setLoadingMarkas(false)
      })
      .catch(() => { setMarkas([]); setLoadingMarkas(false) })
  }, [selectedPartyId])

  // When marka selected, populate lot selections
  useEffect(() => {
    if (!selectedMarka) { setLotSelections([]); return }
    const group = markas.find(m => m.marka === selectedMarka)
    if (group) {
      setLotSelections(group.lots.map(l => ({
        ...l,
        selected: false,
        than: String(l.availableThan),
      })))
    }
  }, [selectedMarka, markas])

  // ─── Matching confirmed fold batches ─────────────────────────────────────────

  const matchingFoldBatches = useMemo(() => {
    if (!selectedPartyId) return []
    const partyName = parties.find(p => p.id === selectedPartyId)?.name ?? ''
    return confirmedFoldBatches.filter(fb => {
      // Match by marka if selected, otherwise show all for this party
      const markaMatch = !selectedMarka || (fb.marka ?? '').split(',').some(m => m.trim() === selectedMarka)
      // Match by party - check if any lot belongs to this party
      const partyMatch = fb.lots.some(l => (l.party?.name ?? '').toLowerCase() === partyName.toLowerCase())
      return markaMatch && partyMatch
    })
  }, [selectedPartyId, selectedMarka, confirmedFoldBatches, parties])

  const selectFoldBatch = (fb: ConfirmedFoldBatch) => {
    setSelectedFoldBatchId(fb.id)
    // Auto-fill marka from fold batch
    if (fb.marka) {
      const firstMarka = fb.marka.split(',')[0].trim()
      if (markas.some(m => m.marka === firstMarka)) {
        setSelectedMarka(firstMarka)
      }
    }
    // Auto-fill shade from fold batch
    const shade = fb.shade?.name ?? fb.shadeName ?? ''
    if (shade) setShadeName(shade)
    // Auto-select lots from fold batch
    setLotSelections(prev => {
      if (prev.length === 0) {
        // Lots not loaded yet from marka - build from fold batch lots
        return fb.lots.map(l => ({
          lotNo: l.lotNo,
          greyThan: l.than,
          availableThan: l.than,
          selected: true,
          than: String(l.than),
        }))
      }
      // Lots already loaded from marka selection - match and select
      return prev.map(ls => {
        const foldLot = fb.lots.find(fl => fl.lotNo === ls.lotNo)
        if (foldLot) {
          return { ...ls, selected: true, than: String(Math.min(foldLot.than, ls.availableThan)) }
        }
        return ls
      })
    })
  }

  // ─── Chemical handlers ──────────────────────────────────────────────────────

  const updateChemical = (idx: number, field: keyof ChemicalRow, value: string) => {
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

  const removeChemical = (idx: number) => setChemicals(prev => prev.filter((_, i) => i !== idx))

  const addChemicalRow = () => {
    setChemicals(prev => [...prev, { chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null, processTag: null }])
  }

  const selectMasterChemical = (idx: number, master: ChemicalMaster) => {
    setChemicals(prev => {
      const updated = [...prev]
      const row = { ...updated[idx] }
      row.chemicalId = master.id
      row.name = master.name
      row.unit = master.unit
      if (master.currentPrice != null) {
        row.rate = String(master.currentPrice)
        const qty = parseFloat(row.quantity)
        if (!isNaN(qty)) row.cost = Math.round(qty * master.currentPrice * 100) / 100
      }
      updated[idx] = row
      return updated
    })
    setChemDropIdx(null)
    setChemSearch('')
  }

  const openProcessPopup = (process: DyeingProcess) => {
    const qtys: Record<number, string> = {}
    process.items.forEach(item => { qtys[item.chemicalId] = String(item.quantity) })
    setProcessQtys(qtys)
    setProcessPopup(process)
  }

  const confirmProcessPopup = () => {
    if (!processPopup) return
    const withoutOld = chemicals.filter(c => c.processTag !== processPopup.name)
    const rows: ChemicalRow[] = processPopup.items.map(item => {
      const master = masterChemicals.find(m => m.id === item.chemicalId)
      const rate = master?.currentPrice != null ? String(master.currentPrice) : ''
      const qty = processQtys[item.chemicalId] || String(item.quantity)
      const rateNum = parseFloat(rate)
      const qtyNum = parseFloat(qty)
      const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? Math.round(rateNum * qtyNum * 100) / 100 : null
      return { chemicalId: item.chemicalId, name: item.chemical.name, quantity: qty, unit: item.chemical.unit || 'kg', rate, cost, processTag: processPopup.name }
    })
    setChemicals([...withoutOld, ...rows])
    setProcessPopup(null)
  }

  const isProcessAdded = (processName: string): boolean => chemicals.some(c => c.processTag === processName)

  // ─── Save ───────────────────────────────────────────────────────────────────

  const selectedLots = lotSelections.filter(l => l.selected && parseInt(l.than) > 0)

  const handleSave = async () => {
    setError('')
    setSuccess('')

    if (!selectedPartyId) { setError('Select a party'); return }
    if (!selectedMarka) { setError('Select a marka'); return }
    if (selectedLots.length === 0) { setError('Select at least one lot'); return }
    if (!slipNo) { setError('Slip No is required'); return }

    setSaving(true)
    try {
      const finalShade = showNewShade ? newShadeName.trim() : shadeName
      const res = await fetch('/api/dyeing/pc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          slipNo: parseInt(slipNo),
          marka: selectedMarka,
          partyInstructions: partyInstructions || null,
          shadeName: finalShade || null,
          machineId: selectedMachineId,
          operatorId: selectedOperatorId,
          lots: selectedLots.map(l => ({ lotNo: l.lotNo, than: parseInt(l.than) })),
          chemicals: chemicals.filter(c => c.name.trim()).map(c => ({
            chemicalId: c.chemicalId,
            name: c.name,
            quantity: c.quantity ? parseFloat(c.quantity) : null,
            unit: c.unit,
            rate: c.rate ? parseFloat(c.rate) : null,
            cost: c.cost,
            processTag: c.processTag,
          })),
        }),
      })

      if (res.ok) {
        const entry = await res.json()
        setSuccess(`Slip #${entry.slipNo} saved!`)
        // Reset form
        setStep(1)
        setSelectedPartyId(null)
        setSelectedMarka('')
        setSelectedFoldBatchId(null)
        setLotSelections([])
        setChemicals([])
        setShadeName('')
        setNewShadeName('')
        setPartyInstructions('')
        setSlipNo(String(parseInt(slipNo) + 1))
        // Refresh saved list
        const fresh = await fetch('/api/dyeing/pc').then(r => r.json())
        setSavedEntries(Array.isArray(fresh) ? fresh : [])
        // Open print
        window.open(`/dyeing/pc/${entry.id}/print`, '_blank')
      } else {
        const err = await res.json()
        setError(err.error || 'Failed to save')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  // ─── Confirm Done ───────────────────────────────────────────────────────────

  const openConfirm = (e: SavedEntry) => {
    setConfirmEntry(e)
    setConfirmPhoto(null)
    setConfirmDate(new Date().toISOString().slice(0, 10))
    setConfirmNotes('')
    setConfirming(false)
  }

  const submitConfirm = async () => {
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
        }),
      })
      if (res.ok) {
        const fresh = await fetch('/api/dyeing/pc').then(r => r.json())
        setSavedEntries(Array.isArray(fresh) ? fresh : [])
        setConfirmEntry(null)
      } else {
        const err = await res.json()
        alert(err.error || 'Failed to confirm')
      }
    } catch { alert('Network error') }
    finally { setConfirming(false) }
  }

  // ─── Addition handlers ──────────────────────────────────────────────────────

  const openAddition = (e: SavedEntry) => {
    setAdditionEntry(e)
    setAddChemRows([{ chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null }])
    setAddReason('')
    setAddSaving(false)
  }

  const submitAddition = async () => {
    if (!additionEntry) return
    setAddSaving(true)
    try {
      const chems = addChemRows.filter(r => r.name.trim()).map(r => ({
        chemicalId: r.chemicalId, name: r.name, quantity: parseFloat(r.quantity) || 0,
        unit: r.unit, rate: r.rate ? parseFloat(r.rate) : null, cost: r.cost,
      }))
      const res = await fetch(`/api/dyeing/${additionEntry.id}/additions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'addition', roundNo: additionEntry.totalRounds ?? 1, reason: addReason || null, chemicals: chems }),
      })
      if (res.ok) {
        const fresh = await fetch('/api/dyeing/pc').then(r => r.json())
        setSavedEntries(Array.isArray(fresh) ? fresh : [])
        setAdditionEntry(null)
      } else { const err = await res.json(); alert(err.error || 'Failed') }
    } catch { alert('Network error') }
    finally { setAddSaving(false) }
  }

  // ─── Re-dye handlers ──────────────────────────────────────────────────────

  const openReDye = (e: SavedEntry) => {
    setReDyeEntry(e)
    setReDyeDefect('')
    setReDyeMachineId(e.machine?.id ?? null)
    setReDyeOperatorId(e.operator?.id ?? null)
    setReDyeReason('')
    setReDyeChemRows([{ chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null }])
    setReDyeSaving(false)
  }

  const submitReDye = async () => {
    if (!reDyeEntry) return
    setReDyeSaving(true)
    try {
      const chems = reDyeChemRows.filter(r => r.name.trim()).map(r => ({
        chemicalId: r.chemicalId, name: r.name, quantity: parseFloat(r.quantity) || 0,
        unit: r.unit, rate: r.rate ? parseFloat(r.rate) : null, cost: r.cost,
      }))
      const res = await fetch(`/api/dyeing/${reDyeEntry.id}/additions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 're-dye', roundNo: (reDyeEntry.totalRounds ?? 1) + 1,
          defectType: reDyeDefect || null, reason: reDyeReason || null,
          machineId: reDyeMachineId, operatorId: reDyeOperatorId, chemicals: chems,
        }),
      })
      if (res.ok) {
        const fresh = await fetch('/api/dyeing/pc').then(r => r.json())
        setSavedEntries(Array.isArray(fresh) ? fresh : [])
        setReDyeEntry(null)
        const roundNo = (reDyeEntry.totalRounds ?? 1) + 1
        window.open(`/dyeing/pc/${reDyeEntry.id}/print?round=${roundNo}`, '_blank')
      } else { const err = await res.json(); alert(err.error || 'Failed') }
    } catch { alert('Network error') }
    finally { setReDyeSaving(false) }
  }

  // ─── Shared chemical row helpers for modals ─────────────────────────────────

  const updateModalChemRow = (
    rows: typeof addChemRows, setRows: typeof setAddChemRows,
    idx: number, field: string, value: string
  ) => {
    setRows(prev => {
      const u = [...prev]
      const row = { ...u[idx], [field]: value }
      if (field === 'quantity' || field === 'rate') {
        const qty = parseFloat(field === 'quantity' ? value : row.quantity)
        const rate = parseFloat(field === 'rate' ? value : row.rate)
        row.cost = !isNaN(qty) && !isNaN(rate) ? Math.round(qty * rate * 100) / 100 : null
      }
      u[idx] = row
      return u
    })
  }

  const selectModalChemMaster = (
    setRows: typeof setAddChemRows, idx: number, c: ChemicalMaster,
    setDrop: (v: number | null) => void
  ) => {
    setRows(prev => {
      const u = [...prev]
      const row = { ...u[idx] }
      row.chemicalId = c.id; row.name = c.name; row.unit = c.unit
      if (c.currentPrice != null) {
        row.rate = String(c.currentPrice)
        const qty = parseFloat(row.quantity)
        if (!isNaN(qty)) row.cost = Math.round(qty * c.currentPrice * 100) / 100
      }
      u[idx] = row
      return u
    })
    setDrop(null)
  }

  // ─── Filtered saved entries ─────────────────────────────────────────────────

  const filteredSaved = useMemo(() => {
    const q = savedSearch.toLowerCase()
    let filtered = savedEntries.filter(e => {
      if (!q) return true
      const allLots = (e.lots?.length ? e.lots.map(l => l.lotNo) : [e.lotNo]).join(' ').toLowerCase()
      return allLots.includes(q) || String(e.slipNo).includes(q) || (e.partyName ?? '').toLowerCase().includes(q) || (e.marka ?? '').toLowerCase().includes(q) || (e.shadeName ?? '').toLowerCase().includes(q)
    })
    filtered.sort((a, b) => {
      switch (savedSort) {
        case 'slip': return b.slipNo - a.slipNo
        case 'party': return (a.partyName ?? '').localeCompare(b.partyName ?? '')
        case 'marka': return (a.marka ?? '').localeCompare(b.marka ?? '')
        default: return new Date(b.date).getTime() - new Date(a.date).getTime()
      }
    })
    return filtered
  }, [savedEntries, savedSearch, savedSort])

  // ─── Styles ─────────────────────────────────────────────────────────────────

  const inp = 'w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
  const btn = 'px-4 py-2 rounded-lg text-sm font-medium transition'
  const btnPrimary = `${btn} bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50`
  const btnSecondary = `${btn} bg-gray-700 text-gray-300 hover:bg-gray-600`

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading PC Dyeing...</div>
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold text-white">PC Dyeing</h1>
            <p className="text-sm text-gray-400 mt-1">Pali PC Job - Marka based dyeing</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-700">
        {(['new', 'saved'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === t ? 'border-teal-500 text-teal-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {t === 'new' ? '+ New Slip' : `Saved (${savedEntries.length})`}
          </button>
        ))}
      </div>

      {/* Messages */}
      {error && <div className="bg-red-900/30 border border-red-700 text-red-400 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}
      {success && <div className="bg-green-900/30 border border-green-700 text-green-400 rounded-lg px-4 py-3 mb-4 text-sm">{success}</div>}

      {/* ═══ NEW SLIP TAB ═══ */}
      {tab === 'new' && (
        <div className="max-w-3xl">
          {/* Steps indicator */}
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map(s => (
              <button key={s} onClick={() => setStep(s)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${step === s ? 'bg-teal-600 text-white' : step > s ? 'bg-teal-900/30 text-teal-400 border border-teal-700' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
                {s}. {s === 1 ? 'Party & Lots' : s === 2 ? 'Slip Details' : 'Chemicals'}
              </button>
            ))}
          </div>

          {/* ── Step 1: Party, Marka, Lots ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Party (Pali PC Job only)</label>
                <select className={inp} value={selectedPartyId ?? ''} onChange={e => { setSelectedPartyId(e.target.value ? parseInt(e.target.value) : null); setSelectedMarka(''); setSelectedFoldBatchId(null) }}>
                  <option value="">Select party...</option>
                  {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {parties.length === 0 && <p className="text-xs text-yellow-500 mt-1">No parties tagged as &quot;Pali PC Job&quot;. Tag parties in Masters &gt; Parties first.</p>}
              </div>

              {selectedPartyId && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Marka</label>
                  {loadingMarkas ? <p className="text-xs text-gray-500">Loading markas...</p> : (
                    <select className={inp} value={selectedMarka} onChange={e => setSelectedMarka(e.target.value)}>
                      <option value="">Select marka...</option>
                      {markas.map(m => <option key={m.marka} value={m.marka}>{m.marka} ({m.lots.length} lots)</option>)}
                    </select>
                  )}
                  {!loadingMarkas && markas.length === 0 && <p className="text-xs text-yellow-500 mt-1">No markas found. Add marka in Grey Inward form for this party.</p>}
                </div>
              )}

              {/* Confirmed PC Fold Batches */}
              {selectedPartyId && matchingFoldBatches.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">Available PC Fold Batches (Confirmed)</label>
                  <div className="space-y-2">
                    {matchingFoldBatches.map(fb => {
                      const totalThan = fb.lots.reduce((s, l) => s + l.than, 0)
                      const isSelected = selectedFoldBatchId === fb.id
                      return (
                        <button
                          key={fb.id}
                          onClick={() => selectFoldBatch(fb)}
                          className={`w-full text-left p-3 rounded-lg border transition ${
                            isSelected
                              ? 'bg-teal-900/30 border-teal-600 ring-1 ring-teal-500'
                              : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-teal-400">{fb.foldNo}</span>
                              <span className="text-xs text-gray-500">B{fb.batchNo}</span>
                              {fb.marka && (
                                <span className="text-xs bg-purple-900/30 text-purple-400 px-1.5 py-0.5 rounded">
                                  {fb.marka}
                                </span>
                              )}
                            </div>
                            <span className="text-sm font-bold text-teal-400">{totalThan} <span className="text-[10px] text-gray-500 font-normal">than</span></span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {(fb.shade?.name ?? fb.shadeName) && (
                              <span className="text-xs text-gray-400">Shade: {fb.shade?.name ?? fb.shadeName}</span>
                            )}
                            <span className="text-xs text-gray-500">
                              {fb.lots.map(l => l.lotNo).join(', ')}
                            </span>
                          </div>
                          {isSelected && (
                            <p className="text-[10px] text-teal-500 mt-1">Selected - lots auto-filled below</p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {selectedMarka && lotSelections.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">Lots under &quot;{selectedMarka}&quot;</label>
                  <div className="space-y-2">
                    {lotSelections.map((lot, i) => (
                      <div key={lot.lotNo} className={`flex items-center gap-3 p-3 rounded-lg border ${lot.selected ? 'bg-teal-900/20 border-teal-700' : 'bg-gray-800 border-gray-700'}`}>
                        <input type="checkbox" checked={lot.selected}
                          onChange={e => setLotSelections(prev => { const u = [...prev]; u[i] = { ...u[i], selected: e.target.checked }; return u })}
                          className="w-4 h-4 rounded text-teal-600 bg-gray-700 border-gray-600" />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-teal-400">{lot.lotNo}</span>
                          <span className="text-xs text-gray-500 ml-2">Grey: {lot.greyThan} | Available: {lot.availableThan}</span>
                        </div>
                        {lot.selected && (
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-400">Than:</label>
                            <input type="number" className="w-20 bg-gray-700 border border-gray-600 text-gray-100 rounded px-2 py-1 text-sm" value={lot.than}
                              onChange={e => setLotSelections(prev => { const u = [...prev]; u[i] = { ...u[i], than: e.target.value }; return u })} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {selectedLots.length > 0 && (
                    <div className="mt-3 text-sm text-gray-400">
                      Selected: {selectedLots.length} lots, {selectedLots.reduce((s, l) => s + parseInt(l.than), 0)} than
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => setStep(2)} disabled={selectedLots.length === 0} className={btnPrimary}>
                Next: Slip Details
              </button>
            </div>
          )}

          {/* ── Step 2: Slip Details ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Slip No</label>
                  <input type="number" className={inp} value={slipNo} onChange={e => setSlipNo(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Date</label>
                  <input type="date" className={inp} value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Machine</label>
                  <select className={inp} value={selectedMachineId ?? ''} onChange={e => setSelectedMachineId(e.target.value ? parseInt(e.target.value) : null)}>
                    <option value="">Select machine...</option>
                    {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Operator</label>
                  <select className={inp} value={selectedOperatorId ?? ''} onChange={e => setSelectedOperatorId(e.target.value ? parseInt(e.target.value) : null)}>
                    <option value="">Select operator...</option>
                    {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Shade</label>
                {!showNewShade ? (
                  <div className="flex gap-2">
                    <select className={`${inp} flex-1`} value={shadeName} onChange={e => setShadeName(e.target.value)}>
                      <option value="">Select shade...</option>
                      {shades.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                    <button onClick={() => setShowNewShade(true)} className={btnSecondary}>+ New</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input type="text" className={`${inp} flex-1`} placeholder="New shade name..." value={newShadeName} onChange={e => setNewShadeName(e.target.value)} />
                    <button onClick={() => { setShowNewShade(false); setNewShadeName('') }} className={btnSecondary}>Cancel</button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Party Instructions</label>
                <input type="text" className={inp} value={partyInstructions} onChange={e => setPartyInstructions(e.target.value)} placeholder="Any special instructions..." />
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className={btnSecondary}>Back</button>
                <button onClick={() => setStep(3)} className={btnPrimary}>Next: Chemicals</button>
              </div>
            </div>
          )}

          {/* ── Step 3: Chemicals ── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Process presets */}
              {processes.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">Process Presets</label>
                  <div className="flex flex-wrap gap-2">
                    {processes.map(p => (
                      <button key={p.id} onClick={() => openProcessPopup(p)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition ${isProcessAdded(p.name) ? 'bg-teal-900/40 border-teal-600 text-teal-300' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>
                        {p.name} {isProcessAdded(p.name) ? '\u2713' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chemical rows */}
              <div className="space-y-2">
                {chemicals.map((chem, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-gray-800 rounded-lg p-2 border border-gray-700">
                    <div className="flex-1 relative">
                      <input type="text" className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-xs"
                        placeholder="Chemical name..." value={chem.name}
                        onChange={e => { updateChemical(idx, 'name', e.target.value); setChemDropIdx(idx); setChemSearch(e.target.value) }}
                        onFocus={() => { setChemDropIdx(idx); setChemSearch(chem.name) }} />
                      {chemDropIdx === idx && chemSearch && (
                        <div className="absolute z-20 mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                          {masterChemicals
                            .filter(m => m.name.toLowerCase().includes(chemSearch.toLowerCase()))
                            .slice(0, 10)
                            .map(m => (
                              <button key={m.id} onClick={() => selectMasterChemical(idx, m)}
                                className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-600 flex justify-between">
                                <span>{m.name}</span>
                                <span className="text-gray-500">{m.unit}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                    <input type="number" step="any" className="w-20 bg-gray-700 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-xs"
                      placeholder="Qty" value={chem.quantity} onChange={e => updateChemical(idx, 'quantity', e.target.value)} />
                    <span className="text-xs text-gray-500 w-6">{chem.unit}</span>
                    {chem.processTag && <span className="text-[10px] text-teal-500 bg-teal-900/30 rounded px-1.5 py-0.5">{chem.processTag}</span>}
                    <button onClick={() => removeChemical(idx)} className="text-red-400 hover:text-red-300 text-sm px-1">&times;</button>
                  </div>
                ))}
              </div>

              <button onClick={addChemicalRow} className={`${btnSecondary} text-xs`}>+ Add Chemical</button>

              <div className="flex gap-3 pt-4 border-t border-gray-700">
                <button onClick={() => setStep(2)} className={btnSecondary}>Back</button>
                <button onClick={handleSave} disabled={saving} className={btnPrimary}>
                  {saving ? 'Saving...' : 'Save & Print'}
                </button>
              </div>

              {/* Summary */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 text-sm text-gray-400">
                <p><span className="text-gray-300 font-medium">Party:</span> {parties.find(p => p.id === selectedPartyId)?.name}</p>
                <p><span className="text-gray-300 font-medium">Marka:</span> {selectedMarka}</p>
                <p><span className="text-gray-300 font-medium">Lots:</span> {selectedLots.map(l => `${l.lotNo} (${l.than})`).join(', ')}</p>
                <p><span className="text-gray-300 font-medium">Slip:</span> #{slipNo} | {date}</p>
                {shadeName && <p><span className="text-gray-300 font-medium">Shade:</span> {showNewShade ? newShadeName : shadeName}</p>}
              </div>
            </div>
          )}

          {/* Process popup */}
          {processPopup && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-md max-h-[80vh] overflow-y-auto">
                <h3 className="text-lg font-bold text-white mb-4">{processPopup.name}</h3>
                <div className="space-y-3">
                  {processPopup.items.map(item => (
                    <div key={item.chemicalId} className="flex items-center gap-3">
                      <span className="flex-1 text-sm text-gray-300">{item.chemical.name}</span>
                      <input type="number" step="any" className="w-24 bg-gray-700 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm"
                        value={processQtys[item.chemicalId] ?? ''} onChange={e => setProcessQtys(prev => ({ ...prev, [item.chemicalId]: e.target.value }))} />
                      <span className="text-xs text-gray-500">{item.chemical.unit}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setProcessPopup(null)} className={btnSecondary}>Cancel</button>
                  <button onClick={confirmProcessPopup} className={btnPrimary}>Apply</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ SAVED TAB ═══ */}
      {tab === 'saved' && (
        <div>
          {/* Search & Sort */}
          <div className="mb-4 space-y-3">
            <input type="text" placeholder="Search slip, marka, lot, party, shade..." value={savedSearch}
              onChange={e => setSavedSearch(e.target.value)}
              className="w-full max-w-md bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-gray-500">Sort:</span>
              {(['date', 'slip', 'party', 'marka'] as const).map(s => (
                <button key={s} onClick={() => setSavedSort(s)}
                  className={`text-xs px-2 py-1 rounded border ${savedSort === s ? 'bg-teal-900/40 border-teal-600 text-teal-300 font-medium' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Cards */}
          {filteredSaved.length === 0 ? (
            <div className="p-12 text-center text-gray-500">{savedEntries.length === 0 ? 'No PC dyeing entries yet.' : 'No results found.'}</div>
          ) : (
            <div className="grid gap-3">
              {filteredSaved.map(e => {
                const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
                const totalThan = lots.reduce((s, l) => s + l.than, 0)
                const isDone = !!e.dyeingDoneAt
                return (
                  <div key={e.id} className={`bg-gray-800 rounded-xl border p-4 ${isDone ? 'border-green-800' : 'border-gray-700'}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-teal-400">#{e.slipNo}</span>
                          <span className="text-xs text-gray-500">{new Date(e.date).toLocaleDateString('en-IN')}</span>
                          {isDone && <span className="text-xs bg-green-900/40 text-green-400 border border-green-700 rounded px-1.5 py-0.5">Done</span>}
                          {e.status === 're-dyeing' && <span className="text-xs bg-yellow-900/40 text-yellow-400 border border-yellow-700 rounded px-1.5 py-0.5">Re-Dyeing</span>}
                        </div>
                        <p className="text-sm text-gray-400 mt-0.5">{e.partyName || 'Unknown Party'}</p>
                      </div>
                      <Link href={`/dyeing/pc/${e.id}/print`} className="text-xs text-teal-400 hover:underline">Print</Link>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                      <div><span className="text-gray-500">Marka:</span> <span className="text-gray-200 font-medium">{e.marka || '-'}</span></div>
                      <div><span className="text-gray-500">Shade:</span> <span className="text-gray-200">{e.shadeName || '-'}</span></div>
                      <div><span className="text-gray-500">Machine:</span> <span className="text-gray-200">{e.machine?.name || '-'}</span></div>
                      <div><span className="text-gray-500">Operator:</span> <span className="text-gray-200">{e.operator?.name || '-'}</span></div>
                    </div>

                    <div className="text-xs text-gray-400 mb-2">
                      <span className="text-gray-500">Lots:</span>{' '}
                      {lots.map((l, i) => (
                        <span key={i}><span className="text-teal-400 font-medium">{l.lotNo}</span> ({l.than}){i < lots.length - 1 ? ', ' : ''}</span>
                      ))}
                      <span className="text-gray-500 ml-2">Total: {totalThan} than</span>
                    </div>

                    {e.partyInstructions && (
                      <div className="text-xs text-yellow-400 bg-yellow-900/20 rounded px-2 py-1 mb-2">
                        Instructions: {e.partyInstructions}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {!isDone && (
                        <>
                          <button onClick={() => openAddition(e)} className="text-xs bg-blue-900/30 border border-blue-700 text-blue-400 rounded-lg px-3 py-1.5 hover:bg-blue-900/50 transition">
                            + Addition
                          </button>
                          <button onClick={() => openReDye(e)} className="text-xs bg-yellow-900/30 border border-yellow-700 text-yellow-400 rounded-lg px-3 py-1.5 hover:bg-yellow-900/50 transition">
                            Re-Dye
                          </button>
                          <button onClick={() => openConfirm(e)} className="text-xs bg-green-900/30 border border-green-700 text-green-400 rounded-lg px-3 py-1.5 hover:bg-green-900/50 transition">
                            Confirm Done
                          </button>
                        </>
                      )}
                      {isDone && e.dyeingPhotoUrl && (
                        <a href={e.dyeingPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">
                          View Photo
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ CONFIRM DONE MODAL ═══ */}
      {confirmEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">Confirm Dyeing Done - Slip #{confirmEntry.slipNo}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Done Date</label>
                <input type="date" className={inp} value={confirmDate} onChange={e => setConfirmDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Photo (optional)</label>
                <input ref={confirmCameraRef} type="file" accept="image/*" capture="environment" className={inp}
                  onChange={async e => { const f = e.target.files?.[0]; if (f) setConfirmPhoto(await readConfirmPhoto(f)) }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
                <input type="text" className={inp} value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirmEntry(null)} className={btnSecondary}>Cancel</button>
              <button onClick={submitConfirm} disabled={confirming} className={btnPrimary}>
                {confirming ? 'Saving...' : 'Confirm Done'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ADDITION MODAL ═══ */}
      {additionEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">Addition - Slip #{additionEntry.slipNo}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Reason</label>
                <input type="text" className={inp} value={addReason} onChange={e => setAddReason(e.target.value)} />
              </div>
              {addChemRows.map((row, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <div className="flex-1 relative">
                    <input type="text" className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-xs" placeholder="Chemical..."
                      value={row.name} onChange={e => { updateModalChemRow(addChemRows, setAddChemRows, idx, 'name', e.target.value); setAddChemDrop(idx); setAddChemSearch(e.target.value) }}
                      onFocus={() => { setAddChemDrop(idx); setAddChemSearch(row.name) }} />
                    {addChemDrop === idx && addChemSearch && (
                      <div className="absolute z-20 mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg shadow-xl max-h-32 overflow-y-auto">
                        {masterChemicals.filter(m => m.name.toLowerCase().includes(addChemSearch.toLowerCase())).slice(0, 8).map(m => (
                          <button key={m.id} onClick={() => selectModalChemMaster(setAddChemRows, idx, m, setAddChemDrop)}
                            className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600">{m.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input type="number" step="any" className="w-20 bg-gray-700 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-xs"
                    placeholder="Qty" value={row.quantity} onChange={e => updateModalChemRow(addChemRows, setAddChemRows, idx, 'quantity', e.target.value)} />
                  <button onClick={() => setAddChemRows(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 text-sm">&times;</button>
                </div>
              ))}
              <button onClick={() => setAddChemRows(prev => [...prev, { chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null }])}
                className="text-xs text-teal-400 hover:text-teal-300">+ Add Row</button>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAdditionEntry(null)} className={btnSecondary}>Cancel</button>
              <button onClick={submitAddition} disabled={addSaving} className={btnPrimary}>{addSaving ? 'Saving...' : 'Save Addition'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ RE-DYE MODAL ═══ */}
      {reDyeEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">Re-Dye - Slip #{reDyeEntry.slipNo}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Defect Type</label>
                  <select className={inp} value={reDyeDefect} onChange={e => setReDyeDefect(e.target.value)}>
                    <option value="">Select...</option>
                    {['patchy', 'uneven', 'light', 'dark', 'spots'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Reason</label>
                  <input type="text" className={inp} value={reDyeReason} onChange={e => setReDyeReason(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Machine</label>
                  <select className={inp} value={reDyeMachineId ?? ''} onChange={e => setReDyeMachineId(e.target.value ? parseInt(e.target.value) : null)}>
                    <option value="">Select...</option>
                    {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Operator</label>
                  <select className={inp} value={reDyeOperatorId ?? ''} onChange={e => setReDyeOperatorId(e.target.value ? parseInt(e.target.value) : null)}>
                    <option value="">Select...</option>
                    {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-2">Chemicals</label>
                {reDyeChemRows.map((row, idx) => (
                  <div key={idx} className="flex gap-2 items-center mb-2">
                    <div className="flex-1 relative">
                      <input type="text" className="w-full bg-gray-700 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-xs" placeholder="Chemical..."
                        value={row.name} onChange={e => { updateModalChemRow(reDyeChemRows, setReDyeChemRows, idx, 'name', e.target.value); setReDyeChemDrop(idx); setReDyeChemSearch(e.target.value) }}
                        onFocus={() => { setReDyeChemDrop(idx); setReDyeChemSearch(row.name) }} />
                      {reDyeChemDrop === idx && reDyeChemSearch && (
                        <div className="absolute z-20 mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg shadow-xl max-h-32 overflow-y-auto">
                          {masterChemicals.filter(m => m.name.toLowerCase().includes(reDyeChemSearch.toLowerCase())).slice(0, 8).map(m => (
                            <button key={m.id} onClick={() => selectModalChemMaster(setReDyeChemRows, idx, m, setReDyeChemDrop)}
                              className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-600">{m.name}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input type="number" step="any" className="w-20 bg-gray-700 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-xs"
                      placeholder="Qty" value={row.quantity} onChange={e => updateModalChemRow(reDyeChemRows, setReDyeChemRows, idx, 'quantity', e.target.value)} />
                    <button onClick={() => setReDyeChemRows(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 text-sm">&times;</button>
                  </div>
                ))}
                <button onClick={() => setReDyeChemRows(prev => [...prev, { chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null }])}
                  className="text-xs text-teal-400 hover:text-teal-300">+ Add Row</button>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setReDyeEntry(null)} className={btnSecondary}>Cancel</button>
              <button onClick={submitReDye} disabled={reDyeSaving} className={btnPrimary}>{reDyeSaving ? 'Saving...' : 'Save Re-Dye & Print'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
