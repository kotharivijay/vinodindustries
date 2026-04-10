'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../BackButton'
import { generateMultiSlipPDF, sharePDF, type SlipData } from '@/lib/pdf-share'

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
  chemicals: { name: string; quantity: number | null; unit: string; cost: number | null; chemicalId?: number | null }[]
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
  status?: string
  totalRounds?: number
  additions?: any[]
}

interface ChemicalMaster {
  id: number
  name: string
  unit: string
  currentPrice: number | null
}

interface MachineOption { id: number; name: string; isActive: boolean }
interface OperatorOption { id: number; name: string; isActive: boolean }
interface ProcessItem { chemicalId: number; quantity: number; chemical: { id: number; name: string; unit: string } }
interface DyeingProcess { id: number; name: string; items: ProcessItem[] }

interface ProductionData {
  totals: { slips: number; than: number; done: number; patchy: number; pending: number; reDyeing: number; totalCost: number; reDyeCost: number }
  byMachine: any[]
  byOperator: any[]
  entries: any[]
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
type Tab = 'entries' | 'summary' | 'production'

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

  // ─── PDF share state ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [sharingPDF, setSharingPDF] = useState(false)

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(e => e.id)))
    }
  }

  async function handleShareSelected() {
    if (selectedIds.size === 0) return
    setSharingPDF(true)
    try {
      const slips: SlipData[] = entries
        .filter(e => selectedIds.has(e.id))
        .map(e => {
          const lotsArr = e.lots?.length ? e.lots : [{ id: 0, lotNo: e.lotNo, than: e.than }]
          return {
            slipNo: e.slipNo,
            date: e.date,
            shadeName: e.shadeName ?? e.foldBatch?.shade?.name ?? null,
            lots: lotsArr.map(l => ({ lotNo: l.lotNo, than: l.than })),
            partyName: e.partyName ?? null,
            chemicals: (e.chemicals || []).map(c => ({
              name: c.name,
              quantity: c.quantity,
              unit: c.unit,
              rate: null,
              cost: c.cost,
              processTag: (c as any).processTag || null,
            })),
            notes: e.notes,
            status: e.status,
            machine: e.machine?.name ?? null,
            operator: e.operator?.name ?? null,
            totalRounds: e.totalRounds ?? null,
            isReDyed: (e.additions?.length ?? 0) > 0,
          }
        })
      const blob = generateMultiSlipPDF(slips)
      await sharePDF(blob, `dyeing_slips_${slips.length}.pdf`)
    } catch (err) {
      console.error('PDF share failed', err)
      alert('Failed to share PDF')
    } finally {
      setSharingPDF(false)
    }
  }

  // ─── Confirm modal state ────────────────────────────────────────────────────
  const [confirmEntry, setConfirmEntry] = useState<DyeingEntry | null>(null)
  const [confirmPhoto, setConfirmPhoto] = useState<{base64: string, mediaType: string} | null>(null)
  const [confirmCmyk, setConfirmCmyk] = useState<{c:number,m:number,y:number,k:number,hex:string} | null>(null)
  const [confirmDate, setConfirmDate] = useState(new Date().toISOString().slice(0,10))
  const [confirmNotes, setConfirmNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const confirmCameraRef = useRef<HTMLInputElement>(null)
  const confirmGalleryRef = useRef<HTMLInputElement>(null)

  // ─── Addition / Re-dye modal state ────────────────────────────────────────
  const [additionEntry, setAdditionEntry] = useState<DyeingEntry | null>(null)
  const [reDyeEntry, setReDyeEntry] = useState<DyeingEntry | null>(null)
  const [addChemRows, setAddChemRows] = useState<{chemicalId: number | null; name: string; quantity: string; unit: string; rate: string; cost: number | null}[]>([])
  const [addReason, setAddReason] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addChemDrop, setAddChemDrop] = useState<number | null>(null)
  const [addChemSearch, setAddChemSearch] = useState('')

  // Re-dye specific
  const [reDyeDefect, setReDyeDefect] = useState('')
  const [reDyePhoto, setReDyePhoto] = useState<{base64: string; mediaType: string} | null>(null)
  const [reDyeMachineId, setReDyeMachineId] = useState<number | null>(null)
  const [reDyeOperatorId, setReDyeOperatorId] = useState<number | null>(null)
  const [reDyeReason, setReDyeReason] = useState('')
  const [reDyeChemRows, setReDyeChemRows] = useState<{chemicalId: number | null; name: string; quantity: string; unit: string; rate: string; cost: number | null}[]>([])
  const [reDyeSaving, setReDyeSaving] = useState(false)
  const [reDyeChemDrop, setReDyeChemDrop] = useState<number | null>(null)
  const [reDyeChemSearch, setReDyeChemSearch] = useState('')
  const reDyeCameraRef = useRef<HTMLInputElement>(null)
  const reDyeGalleryRef = useRef<HTMLInputElement>(null)

  // Master data for popups
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [operators, setOperators] = useState<OperatorOption[]>([])
  const [processes, setProcesses] = useState<DyeingProcess[]>([])

  // Production tab state
  const [prodData, setProdData] = useState<ProductionData | null>(null)
  const [prodLoading, setProdLoading] = useState(false)
  const [prodPeriod, setProdPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('month')
  const [prodFrom, setProdFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10) })
  const [prodTo, setProdTo] = useState(() => new Date().toISOString().slice(0,10))
  const [prodView, setProdView] = useState<'status' | 'machine' | 'operator'>('status')
  const [prodStatusFilter, setProdStatusFilter] = useState<string | null>(null)
  const [expandedMachine, setExpandedMachine] = useState<number | null>(null)
  const [expandedOperator, setExpandedOperator] = useState<number | null>(null)

  // Load master data for popups (lazy)
  useEffect(() => {
    if (additionEntry || reDyeEntry) {
      if (masterChemicals.length === 0) {
        fetch('/api/chemicals').then(r => r.json()).then(d => setMasterChemicals(Array.isArray(d) ? d : [])).catch(() => {})
      }
      if (machines.length === 0) {
        fetch('/api/dyeing/machines').then(r => r.json()).then(d => setMachines(Array.isArray(d) ? d.filter((m: any) => m.isActive) : [])).catch(() => {})
      }
      if (operators.length === 0) {
        fetch('/api/dyeing/operators?active=true').then(r => r.json()).then(d => setOperators(Array.isArray(d) ? d : [])).catch(() => {})
      }
      if (processes.length === 0) {
        fetch('/api/dyeing/processes').then(r => r.json()).then(d => setProcesses(Array.isArray(d) ? d : [])).catch(() => {})
      }
    }
  }, [additionEntry, reDyeEntry]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ─── Addition handlers ──────────────────────────────────────────────────────
  function openAddition(e: DyeingEntry) {
    setAdditionEntry(e)
    setAddChemRows([{ chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null }])
    setAddReason('')
    setAddSaving(false)
  }

  function closeAddition() {
    setAdditionEntry(null)
    setAddChemRows([])
    setAddChemDrop(null)
  }

  async function submitAddition() {
    if (!additionEntry) return
    setAddSaving(true)
    try {
      const chemicals = addChemRows.filter(r => r.name.trim()).map(r => ({
        chemicalId: r.chemicalId,
        name: r.name,
        quantity: parseFloat(r.quantity) || 0,
        unit: r.unit,
        rate: r.rate ? parseFloat(r.rate) : null,
        cost: r.cost,
      }))
      const res = await fetch(`/api/dyeing/${additionEntry.id}/additions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'addition',
          roundNo: (additionEntry.totalRounds ?? 1) + 1,
          reason: addReason || null,
          chemicals,
        }),
      })
      if (res.ok) { mutate(); closeAddition() }
      else { const err = await res.json(); alert(err.error || 'Failed') }
    } catch { alert('Network error') }
    finally { setAddSaving(false) }
  }

  // ─── Re-dye handlers ──────────────────────────────────────────────────────
  function openReDye(e: DyeingEntry) {
    setReDyeEntry(e)
    setReDyeDefect('')
    setReDyePhoto(null)
    setReDyeMachineId(e.machine?.id ?? null)
    setReDyeOperatorId(e.operator?.id ?? null)
    setReDyeReason('')
    setReDyeChemRows([{ chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null }])
    setReDyeSaving(false)
  }

  function closeReDye() {
    setReDyeEntry(null)
    setReDyeChemRows([])
    setReDyeChemDrop(null)
    setReDyePhoto(null)
  }

  async function handleReDyePhoto(file: File) {
    const photo = await readConfirmPhoto(file)
    setReDyePhoto(photo)
  }

  function applyProcessToReDye(p: DyeingProcess) {
    const rows = p.items.map(item => {
      const master = masterChemicals.find(m => m.id === item.chemicalId)
      const rate = master?.currentPrice != null ? String(master.currentPrice) : ''
      const qty = String(item.quantity)
      const rateNum = parseFloat(rate)
      const qtyNum = parseFloat(qty)
      const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? Math.round(rateNum * qtyNum * 100) / 100 : null
      return { chemicalId: item.chemicalId, name: item.chemical.name, quantity: qty, unit: item.chemical.unit || 'kg', rate, cost }
    })
    setReDyeChemRows(prev => [...prev.filter(r => r.name.trim()), ...rows])
  }

  async function submitReDye() {
    if (!reDyeEntry) return
    setReDyeSaving(true)
    try {
      const chemicals = reDyeChemRows.filter(r => r.name.trim()).map(r => ({
        chemicalId: r.chemicalId,
        name: r.name,
        quantity: parseFloat(r.quantity) || 0,
        unit: r.unit,
        rate: r.rate ? parseFloat(r.rate) : null,
        cost: r.cost,
      }))
      const res = await fetch(`/api/dyeing/${reDyeEntry.id}/additions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 're-dye',
          roundNo: (reDyeEntry.totalRounds ?? 1) + 1,
          defectType: reDyeDefect || null,
          defectPhoto: reDyePhoto?.base64 || null,
          reason: reDyeReason || null,
          machineId: reDyeMachineId,
          operatorId: reDyeOperatorId,
          chemicals,
        }),
      })
      if (res.ok) {
        mutate()
        closeReDye()
        // Open print for re-dye slip
        const addition = await res.json()
        const roundNo = (reDyeEntry.totalRounds ?? 1) + 1
        window.open(`/dyeing/${reDyeEntry.id}/print?round=${roundNo}`, '_blank')
      } else { const err = await res.json(); alert(err.error || 'Failed') }
    } catch { alert('Network error') }
    finally { setReDyeSaving(false) }
  }

  // ─── Chemical row helpers for popups ───────────────────────────────────────
  function updateChemRow(
    rows: typeof addChemRows,
    setRows: typeof setAddChemRows,
    idx: number,
    field: string,
    value: string
  ) {
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

  function selectChemMaster(
    rows: typeof addChemRows,
    setRows: typeof setAddChemRows,
    idx: number,
    c: ChemicalMaster,
    setDrop: (v: number | null) => void
  ) {
    setRows(prev => {
      const u = [...prev]
      const row = { ...u[idx] }
      row.chemicalId = c.id
      row.name = c.name
      row.unit = c.unit
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

  // ─── Production tab ───────────────────────────────────────────────────────
  function loadProduction(period?: string) {
    setProdLoading(true)
    let from = prodFrom, to = prodTo
    const now = new Date()
    const p = period || prodPeriod
    if (p === 'today') {
      from = to = now.toISOString().slice(0,10)
    } else if (p === 'week') {
      const d = new Date(now)
      d.setDate(d.getDate() - d.getDay())
      from = d.toISOString().slice(0,10)
      to = now.toISOString().slice(0,10)
    } else if (p === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10)
      to = now.toISOString().slice(0,10)
    }
    setProdFrom(from); setProdTo(to)
    fetch(`/api/dyeing/production?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { setProdData(d); setProdLoading(false) })
      .catch(() => setProdLoading(false))
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
      const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
      for (const lot of lots) {
        const ex = map.get(lot.lotNo)
        if (!ex) {
          map.set(lot.lotNo, { lotNo: lot.lotNo, entries: 1, totalThan: lot.than, slips: String(e.slipNo), lastDate: e.date })
        } else {
          ex.entries++
          ex.totalThan += lot.than
          if (!ex.slips.includes(String(e.slipNo))) ex.slips = ex.slips + ', ' + e.slipNo
          if (new Date(e.date) > new Date(ex.lastDate)) ex.lastDate = e.date
        }
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
      <div className="flex gap-1 mb-5 border-b border-gray-700 overflow-x-auto">
        {([['entries', 'All Entries', entries.length], ['summary', 'Lot Summary', lotSummary.length], ['production', 'Production', null]] as const).map(([key, label, count]) => (
          <button key={key} onClick={() => { setTab(key as Tab); if (key === 'production' && !prodData) loadProduction() }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px whitespace-nowrap ${tab === key ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {label}
            {count !== null && <span className="ml-2 bg-gray-700 text-gray-300 text-xs rounded-full px-2 py-0.5">{count}</span>}
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
            {/* Share selected bar */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 bg-green-900/30 border border-green-700 rounded-lg px-4 py-2 mt-2">
                <span className="text-xs text-green-300 font-medium">{selectedIds.size} selected</span>
                <button onClick={handleShareSelected} disabled={sharingPDF}
                  className="text-xs font-medium bg-green-700 text-white px-3 py-1 rounded hover:bg-green-600 disabled:opacity-50">
                  {sharingPDF ? 'Preparing…' : '📄 Share as PDF'}
                </button>
                <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-200 ml-auto">Clear</button>
              </div>
            )}
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
                              <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelect(e.id)} className="accent-green-500 mr-1" />
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
                          {/* Status badge */}
                          {(e.status === 'patchy') && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-red-400 bg-red-900/20 border border-red-800 px-2 py-0.5 rounded-full mt-1 font-medium">Patchy (Round {e.totalRounds ?? 1})</span>
                          )}
                          {(e.status === 're-dyeing') && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 border border-amber-800 px-2 py-0.5 rounded-full mt-1 font-medium">Re-dyeing (Round {e.totalRounds ?? 1})</span>
                          )}
                          {/* Round summary */}
                          {e.additions && e.additions.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              <div className="text-[10px] text-gray-500">
                                Round 1: {e.chemicals?.length ?? 0} chemicals{(() => { const c = e.chemicals?.reduce((s: number, x: any) => s + (x.cost ?? 0), 0) ?? 0; return c > 0 ? ` \u00b7 \u20B9${c.toFixed(0)}` : '' })()}
                              </div>
                              {e.additions.map((a: any) => {
                                const ac = a.chemicals?.reduce((s: number, x: any) => s + (x.cost ?? 0), 0) ?? 0
                                return (
                                  <div key={a.id} className="text-[10px] text-gray-500 flex items-center gap-1">
                                    <span>Round {a.roundNo}: +{a.chemicals?.length ?? 0} chemicals{ac > 0 ? ` \u00b7 +\u20B9${ac.toFixed(0)}` : ''} {a.type === 're-dye' && a.defectType ? `(${a.defectType})` : ''}</span>
                                    <Link href={`/dyeing/${e.id}/print?round=${a.roundNo}`} target="_blank" className="text-purple-400 hover:text-purple-300 underline">🖨️</Link>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          {/* Addition + Re-Dye buttons */}
                          {(!e.dyeingDoneAt && e.status !== 'done') && (
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => openAddition(e)} className="flex-1 flex items-center justify-center gap-1.5 bg-amber-900/20 border border-amber-700 text-amber-400 rounded-lg px-3 py-2 text-xs font-medium hover:bg-amber-900/30 transition">
                                + Addition
                              </button>
                              <button onClick={() => openReDye(e)} className="flex-1 flex items-center justify-center gap-1.5 bg-red-900/20 border border-red-700 text-red-400 rounded-lg px-3 py-2 text-xs font-medium hover:bg-red-900/30 transition">
                                Re-Dye
                              </button>
                            </div>
                          )}
                          <DyeingStatus e={e} />
                          <Link href={`/dyeing/${e.id}/print`} target="_blank" className="mt-1 inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-purple-300">Print Slip</Link>
                        </div>
                      )
                    })}
                  </div>

                  {/* ── Desktop table ── */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-700/60 border-b border-gray-700">
                        <tr>
                          <th className="px-2 py-3 text-center w-8">
                            <input type="checkbox" checked={filtered.length > 0 && selectedIds.size === filtered.length} onChange={toggleSelectAll} className="accent-green-500" />
                          </th>
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
                            <td className="px-2 py-2.5 text-center">
                              <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelect(e.id)} className="accent-green-500" />
                            </td>
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

      {/* ── PRODUCTION TAB ── */}
      {tab === 'production' && (
        <div>
          {/* Period selector */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(['today', 'week', 'month', 'custom'] as const).map(p => (
              <button key={p} onClick={() => { setProdPeriod(p); if (p !== 'custom') loadProduction(p) }}
                className={`text-xs px-3 py-1.5 rounded border ${prodPeriod === p ? 'bg-purple-900/40 border-purple-600 text-purple-300 font-medium' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>
                {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Custom'}
              </button>
            ))}
            {prodPeriod === 'custom' && (
              <div className="flex gap-2 items-center">
                <input type="date" value={prodFrom} onChange={e => setProdFrom(e.target.value)}
                  className="bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1 text-xs" />
                <span className="text-gray-500 text-xs">to</span>
                <input type="date" value={prodTo} onChange={e => setProdTo(e.target.value)}
                  className="bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1 text-xs" />
                <button onClick={() => loadProduction('custom')} className="bg-purple-600 text-white text-xs px-3 py-1 rounded hover:bg-purple-700">Go</button>
              </div>
            )}
          </div>

          {/* View selector */}
          <div className="flex gap-2 mb-4">
            {(['status', 'machine', 'operator'] as const).map(v => (
              <button key={v} onClick={() => setProdView(v)}
                className={`text-xs px-3 py-1.5 rounded border ${prodView === v ? 'bg-indigo-900/40 border-indigo-600 text-indigo-300 font-medium' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>
                {v === 'status' ? 'By Status' : v === 'machine' ? 'By Machine' : 'By Operator'}
              </button>
            ))}
          </div>

          {prodLoading ? <div className="p-12 text-center text-gray-500">Loading...</div> : !prodData ? <div className="p-12 text-center text-gray-500">Click a period to load data.</div> : (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  { label: 'Total Slips', value: prodData.totals.slips, sub: `${prodData.totals.than} than`, color: 'text-white', filter: null },
                  { label: 'Done', value: prodData.totals.done, sub: null, color: 'text-green-400', filter: 'done' },
                  { label: 'Patchy', value: prodData.totals.patchy, sub: prodData.totals.reDyeCost > 0 ? `+\u20B9${prodData.totals.reDyeCost.toFixed(0)}` : null, color: 'text-red-400', filter: 'patchy' },
                  { label: 'Pending', value: prodData.totals.pending, sub: null, color: 'text-amber-400', filter: 'pending' },
                ].map((card, ci) => (
                  <button key={ci} onClick={() => setProdStatusFilter(prodStatusFilter === card.filter ? null : card.filter)}
                    className={`bg-gray-800 rounded-xl border p-4 text-left transition ${prodStatusFilter === card.filter ? 'border-purple-500' : 'border-gray-700 hover:border-gray-600'}`}>
                    <p className="text-xs text-gray-400 uppercase tracking-wide">{card.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
                    {card.sub && <p className="text-xs text-gray-500 mt-0.5">{card.sub}</p>}
                  </button>
                ))}
              </div>

              {prodData.totals.totalCost > 0 && (
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 mb-5 flex items-center justify-between">
                  <span className="text-sm text-gray-400">Total Cost</span>
                  <span className="text-lg font-bold text-purple-400">{'\u20B9'}{prodData.totals.totalCost.toFixed(0)}</span>
                  {prodData.totals.slips > 0 && prodData.totals.patchy > 0 && (
                    <span className="text-xs text-red-400">Re-dye rate: {((prodData.totals.patchy / prodData.totals.slips) * 100).toFixed(1)}%</span>
                  )}
                </div>
              )}

              {/* By Status view */}
              {prodView === 'status' && (
                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                  <div className="divide-y divide-gray-700">
                    {prodData.entries
                      .filter((e: any) => {
                        if (!prodStatusFilter) return true
                        const st = e.status || (e.dyeingDoneAt ? 'done' : 'pending')
                        return st === prodStatusFilter
                      })
                      .map((e: any) => {
                        const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
                        const totalThan = lots.reduce((s: number, l: any) => s + l.than, 0)
                        const chemCost = e.chemicals?.reduce((s: number, c: any) => s + (c.cost ?? 0), 0) ?? 0
                        const addCost = e.additions?.reduce((s: number, a: any) => s + (a.chemicals?.reduce((s2: number, c: any) => s2 + (c.cost ?? 0), 0) ?? 0), 0) ?? 0
                        const st = e.status || (e.dyeingDoneAt ? 'done' : 'pending')
                        return (
                          <div key={e.id} className="p-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-sm">
                                <Link href={`/dyeing/${e.id}`} className="text-purple-400 font-medium hover:underline">Slip {e.slipNo}</Link>
                                <span className="text-gray-500 text-xs">{new Date(e.date).toLocaleDateString('en-IN')}</span>
                                {st === 'done' && <span className="text-green-400 text-xs">Done</span>}
                                {st === 'patchy' && <span className="text-red-400 text-xs">Patchy</span>}
                                {st === 'pending' && <span className="text-amber-400 text-xs">Pending</span>}
                              </div>
                              <div className="text-xs text-gray-500 truncate">
                                {lots.map((l: any) => l.lotNo).join(', ')} ({totalThan} than) {e.shadeName ? `| ${e.shadeName}` : ''}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-medium text-purple-400">{'\u20B9'}{(chemCost + addCost).toFixed(0)}</div>
                              {addCost > 0 && <div className="text-[10px] text-red-400">+{'\u20B9'}{addCost.toFixed(0)} re-dye</div>}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* By Machine view */}
              {prodView === 'machine' && (
                <div className="space-y-3">
                  {prodData.byMachine.map((m: any) => (
                    <div key={m.machineId} className="bg-gray-800 rounded-xl border border-gray-700">
                      <button onClick={() => setExpandedMachine(expandedMachine === m.machineId ? null : m.machineId)}
                        className="w-full p-4 flex items-center justify-between text-left">
                        <div>
                          <h3 className="text-sm font-semibold text-white">{m.name}</h3>
                          <div className="flex gap-3 text-xs text-gray-400 mt-1">
                            <span>{m.slips} slips</span>
                            <span>{m.than} than</span>
                            <span className="text-green-400">{m.done} done</span>
                            {m.patchy > 0 && <span className="text-red-400">{m.patchy} patchy</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-purple-400">{'\u20B9'}{m.cost.toFixed(0)}</div>
                          <div className="text-xs text-gray-500">{expandedMachine === m.machineId ? '\u25B2' : '\u25BC'}</div>
                        </div>
                      </button>
                      {expandedMachine === m.machineId && (
                        <div className="border-t border-gray-700 divide-y divide-gray-700/50">
                          {m.entries.map((e: any) => (
                            <div key={e.id} className="px-4 py-2 flex items-center justify-between text-xs">
                              <div>
                                <Link href={`/dyeing/${e.id}`} className="text-purple-400 hover:underline">Slip {e.slipNo}</Link>
                                <span className="text-gray-500 ml-2">{e.lotNo} ({e.than} than)</span>
                              </div>
                              <span className={e.status === 'done' ? 'text-green-400' : e.status === 'patchy' ? 'text-red-400' : 'text-amber-400'}>{e.status || 'pending'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {prodData.byMachine.length === 0 && <p className="text-center text-gray-500 py-8">No machine data.</p>}
                </div>
              )}

              {/* By Operator view */}
              {prodView === 'operator' && (
                <div className="space-y-3">
                  {/* Bar chart comparison */}
                  {prodData.byOperator.length > 1 && (
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 mb-4">
                      <h3 className="text-xs text-gray-400 uppercase tracking-wide mb-3">Comparison</h3>
                      {(() => {
                        const maxSlips = Math.max(...prodData.byOperator.map((o: any) => o.slips), 1)
                        return prodData.byOperator.map((o: any) => (
                          <div key={o.operatorId} className="mb-2">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-gray-300">{o.name}</span>
                              <span className="text-gray-400">{o.slips} slips | {o.done} done {o.patchy > 0 ? `| ${o.patchy} patchy` : ''}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-3">
                              <div className="bg-purple-600 h-3 rounded-full transition-all" style={{ width: `${(o.slips / maxSlips) * 100}%` }} />
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                  {prodData.byOperator.map((o: any) => (
                    <div key={o.operatorId} className="bg-gray-800 rounded-xl border border-gray-700">
                      <button onClick={() => setExpandedOperator(expandedOperator === o.operatorId ? null : o.operatorId)}
                        className="w-full p-4 flex items-center justify-between text-left">
                        <div>
                          <h3 className="text-sm font-semibold text-white">{o.name}</h3>
                          <div className="flex gap-3 text-xs text-gray-400 mt-1">
                            <span>{o.slips} slips</span>
                            <span>{o.than} than</span>
                            <span className="text-green-400">{o.done} done</span>
                            {o.patchy > 0 && <span className="text-red-400">{o.patchy} patchy</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-purple-400">{'\u20B9'}{o.cost.toFixed(0)}</div>
                          <div className="text-xs text-gray-500">{expandedOperator === o.operatorId ? '\u25B2' : '\u25BC'}</div>
                        </div>
                      </button>
                      {expandedOperator === o.operatorId && (
                        <div className="border-t border-gray-700 divide-y divide-gray-700/50">
                          {o.entries.map((e: any) => (
                            <div key={e.id} className="px-4 py-2 flex items-center justify-between text-xs">
                              <div>
                                <Link href={`/dyeing/${e.id}`} className="text-purple-400 hover:underline">Slip {e.slipNo}</Link>
                                <span className="text-gray-500 ml-2">{e.lotNo} ({e.than} than)</span>
                              </div>
                              <span className={e.status === 'done' ? 'text-green-400' : e.status === 'patchy' ? 'text-red-400' : 'text-amber-400'}>{e.status || 'pending'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {prodData.byOperator.length === 0 && <p className="text-center text-gray-500 py-8">No operator data.</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Confirm Dyeing Modal ── */}
      {confirmEntry && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center">
          <div className="bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto border border-gray-700">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-lg font-bold text-white">Confirm Dyeing Done</h2>
              <button onClick={closeConfirm} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-4">
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
              <div>
                <label className="block text-xs text-gray-400 mb-2">Photo of dyed fabric</label>
                <div className="flex gap-2">
                  <button onClick={() => confirmCameraRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 bg-gray-800 border border-gray-600 text-gray-300 rounded-lg px-3 py-3 text-sm hover:bg-gray-700 transition">Camera</button>
                  <button onClick={() => confirmGalleryRef.current?.click()} className="flex-1 flex items-center justify-center gap-2 bg-gray-800 border border-gray-600 text-gray-300 rounded-lg px-3 py-3 text-sm hover:bg-gray-700 transition">Gallery</button>
                </div>
                <input ref={confirmCameraRef} type="file" accept="image/*" capture className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleConfirmPhoto(f); e.target.value = '' }} />
                <input ref={confirmGalleryRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleConfirmPhoto(f); e.target.value = '' }} />
              </div>
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
                          <div className="text-sm font-mono text-gray-200">C:{confirmCmyk.c} M:{confirmCmyk.m} Y:{confirmCmyk.y} K:{confirmCmyk.k}</div>
                          <div className="text-xs text-gray-500 font-mono">{confirmCmyk.hex}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Date completed</label>
                <input type="date" value={confirmDate} onChange={e => setConfirmDate(e.target.value)} className="w-full bg-gray-800 border border-gray-600 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
                <textarea value={confirmNotes} onChange={e => setConfirmNotes(e.target.value)} rows={2} placeholder="Any notes about the dyeing result..." className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" />
              </div>
              <button onClick={submitConfirm} disabled={confirming} className="w-full bg-green-600 text-white font-semibold rounded-lg px-4 py-3 text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                {confirming ? 'Confirming...' : 'Confirm Dyeing Done'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Addition Popup ── */}
      {additionEntry && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center">
          <div className="bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto border border-gray-700">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-lg font-bold text-white">Addition</h2>
              <button onClick={closeAddition} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-gray-400">Slip</span>
                  <span className="text-purple-400 font-semibold">{additionEntry.slipNo}</span>
                  <span className="text-gray-600">|</span>
                  <span className="text-gray-400">Lot</span>
                  <span className="text-purple-300 font-semibold">{additionEntry.lots?.length ? additionEntry.lots.map(l => l.lotNo).join(', ') : additionEntry.lotNo}</span>
                </div>
                {additionEntry.shadeName && (
                  <span className="inline-block bg-purple-700/50 text-purple-200 text-xs font-bold px-2 py-0.5 rounded-full mt-1">{additionEntry.shadeName}</span>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Reason</label>
                <input type="text" value={addReason} onChange={e => setAddReason(e.target.value)} placeholder="Why this addition?"
                  className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-2">Chemicals</label>
                {addChemRows.map((row, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-start">
                    <div className="flex-1 relative">
                      <input type="text" placeholder="Search chemical..." value={row.name}
                        onChange={e => { updateChemRow(addChemRows, setAddChemRows, idx, 'name', e.target.value); setAddChemDrop(idx); setAddChemSearch(e.target.value) }}
                        onFocus={() => { setAddChemDrop(idx); setAddChemSearch(row.name) }}
                        className="w-full bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
                      {addChemDrop === idx && (() => {
                        const q = (addChemSearch || row.name).toLowerCase()
                        const filtered = masterChemicals.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8)
                        return filtered.length > 0 ? (
                          <div className="absolute z-50 w-full bg-gray-800 border border-gray-600 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-xl">
                            {filtered.map(c => (
                              <button key={c.id} className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-purple-900/40"
                                onClick={() => { selectChemMaster(addChemRows, setAddChemRows, idx, c, setAddChemDrop); setAddChemSearch('') }}>
                                {c.name} <span className="text-gray-500 text-xs">({c.unit})</span>
                              </button>
                            ))}
                          </div>
                        ) : null
                      })()}
                    </div>
                    <input type="number" step="0.01" placeholder="Qty" value={row.quantity}
                      onChange={e => updateChemRow(addChemRows, setAddChemRows, idx, 'quantity', e.target.value)}
                      className="w-20 bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm" />
                    <button onClick={() => setAddChemRows(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 text-sm px-1 mt-1">X</button>
                  </div>
                ))}
                <button onClick={() => setAddChemRows(prev => [...prev, { chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null }])}
                  className="text-xs text-purple-400 hover:text-purple-300 border border-purple-700 rounded px-3 py-1.5">+ Add Row</button>
              </div>
              <button onClick={submitAddition} disabled={addSaving}
                className="w-full bg-amber-600 text-white font-semibold rounded-lg px-4 py-3 text-sm hover:bg-amber-700 disabled:opacity-50 transition">
                {addSaving ? 'Saving...' : 'Save Addition'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Re-Dye Popup ── */}
      {reDyeEntry && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center">
          <div className="bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[95vh] overflow-y-auto border border-gray-700">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-lg font-bold text-white">Re-Dye</h2>
              <button onClick={closeReDye} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-4">
              {/* Entry info */}
              <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-gray-400">Slip</span>
                  <span className="text-purple-400 font-semibold">{reDyeEntry.slipNo}</span>
                  <span className="text-gray-600">|</span>
                  <span className="text-gray-400">Lot</span>
                  <span className="text-purple-300 font-semibold">{reDyeEntry.lots?.length ? reDyeEntry.lots.map(l => l.lotNo).join(', ') : reDyeEntry.lotNo}</span>
                </div>
                {reDyeEntry.shadeName && (
                  <span className="inline-block bg-purple-700/50 text-purple-200 text-xs font-bold px-2 py-0.5 rounded-full mt-1">{reDyeEntry.shadeName}</span>
                )}
              </div>

              {/* Defect type buttons */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">Defect Type</label>
                <div className="flex flex-wrap gap-2">
                  {['patchy', 'uneven', 'light', 'dark', 'spots'].map(dt => (
                    <button key={dt} onClick={() => setReDyeDefect(reDyeDefect === dt ? '' : dt)}
                      className={`text-xs px-3 py-1.5 rounded-lg border capitalize ${reDyeDefect === dt ? 'bg-red-900/40 border-red-600 text-red-300 font-medium' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}>
                      {dt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Defect photo */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">Defect Photo</label>
                <div className="flex gap-2">
                  <button onClick={() => reDyeCameraRef.current?.click()} className="flex-1 bg-gray-800 border border-gray-600 text-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-700">Camera</button>
                  <button onClick={() => reDyeGalleryRef.current?.click()} className="flex-1 bg-gray-800 border border-gray-600 text-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-gray-700">Gallery</button>
                </div>
                <input ref={reDyeCameraRef} type="file" accept="image/*" capture className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleReDyePhoto(f); e.target.value = '' }} />
                <input ref={reDyeGalleryRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleReDyePhoto(f); e.target.value = '' }} />
                {reDyePhoto && (
                  <div className="mt-2 rounded-lg overflow-hidden border border-gray-700">
                    <img src={`data:${reDyePhoto.mediaType};base64,${reDyePhoto.base64}`} alt="Defect" className="w-full max-h-40 object-cover" />
                  </div>
                )}
              </div>

              {/* Machine + Operator */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Machine</label>
                  <select value={reDyeMachineId ?? ''} onChange={e => setReDyeMachineId(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full bg-gray-800 border border-gray-600 text-gray-100 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select</option>
                    {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Operator</label>
                  <select value={reDyeOperatorId ?? ''} onChange={e => setReDyeOperatorId(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full bg-gray-800 border border-gray-600 text-gray-100 rounded-lg px-3 py-2 text-sm">
                    <option value="">Select</option>
                    {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Reason</label>
                <input type="text" value={reDyeReason} onChange={e => setReDyeReason(e.target.value)} placeholder="Why re-dyeing?"
                  className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>

              {/* Process presets */}
              {processes.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-2">Apply Process Preset</label>
                  <div className="flex flex-wrap gap-2">
                    {processes.map(p => (
                      <button key={p.id} onClick={() => applyProcessToReDye(p)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-indigo-700 bg-indigo-900/20 text-indigo-300 hover:bg-indigo-900/40">
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chemical rows */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">Chemicals</label>
                {reDyeChemRows.map((row, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-start">
                    <div className="flex-1 relative">
                      <input type="text" placeholder="Search chemical..." value={row.name}
                        onChange={e => { updateChemRow(reDyeChemRows, setReDyeChemRows, idx, 'name', e.target.value); setReDyeChemDrop(idx); setReDyeChemSearch(e.target.value) }}
                        onFocus={() => { setReDyeChemDrop(idx); setReDyeChemSearch(row.name) }}
                        className="w-full bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
                      {reDyeChemDrop === idx && (() => {
                        const q = (reDyeChemSearch || row.name).toLowerCase()
                        const filtered = masterChemicals.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8)
                        return filtered.length > 0 ? (
                          <div className="absolute z-50 w-full bg-gray-800 border border-gray-600 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-xl">
                            {filtered.map(c => (
                              <button key={c.id} className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-purple-900/40"
                                onClick={() => { selectChemMaster(reDyeChemRows, setReDyeChemRows, idx, c, setReDyeChemDrop); setReDyeChemSearch('') }}>
                                {c.name} <span className="text-gray-500 text-xs">({c.unit})</span>
                              </button>
                            ))}
                          </div>
                        ) : null
                      })()}
                    </div>
                    <input type="number" step="0.01" placeholder="Qty" value={row.quantity}
                      onChange={e => updateChemRow(reDyeChemRows, setReDyeChemRows, idx, 'quantity', e.target.value)}
                      className="w-20 bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm" />
                    <input type="number" step="0.01" placeholder="Rate" value={row.rate}
                      onChange={e => updateChemRow(reDyeChemRows, setReDyeChemRows, idx, 'rate', e.target.value)}
                      className="w-20 bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm" />
                    <button onClick={() => setReDyeChemRows(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 text-sm px-1 mt-1">X</button>
                  </div>
                ))}
                <button onClick={() => setReDyeChemRows(prev => [...prev, { chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '', cost: null }])}
                  className="text-xs text-purple-400 hover:text-purple-300 border border-purple-700 rounded px-3 py-1.5">+ Add Row</button>
              </div>

              <button onClick={submitReDye} disabled={reDyeSaving}
                className="w-full bg-red-600 text-white font-semibold rounded-lg px-4 py-3 text-sm hover:bg-red-700 disabled:opacity-50 transition">
                {reDyeSaving ? 'Saving...' : 'Save & Print Re-Dye Slip'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
