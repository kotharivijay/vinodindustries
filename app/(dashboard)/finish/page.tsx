'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { LotLink, useLotBackHighlight, persistViewState, readViewState } from '@/lib/viewStatePersist'

const FINISH_VIEW_KEY = 'finish-view-state'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../BackButton'
import { useRole } from '../RoleContext'

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

/* ── Types ────────────────────────────────────────────────────────── */

interface StockLot {
  lotNo: string
  than: number
  party: string | null
  quality: string | null
  weight: string | null
  mtrPerThan: number | null
}

interface StockEntry {
  id: number
  slipNo: number
  date: string
  shadeName: string | null
  shadeDescription: string | null
  foldNo: string | null
  batchNo: number | null
  marka: string | null
  isPcJob: boolean
  machineName: string | null
  operatorName: string | null
  lots: StockLot[]
  totalThan: number
}

type SortField = 'date' | 'slipNo' | 'lotNo' | 'party' | 'quality' | 'than'
type SortDir = 'asc' | 'desc'
type Tab = 'slips' | 'register' | 'report' | 'packing' | 'folding'

function getValue(e: StockEntry, f: SortField): string | number {
  switch (f) {
    case 'date': return new Date(e.date).getTime()
    case 'slipNo': return e.slipNo
    case 'lotNo': return (e.lots.map(l => l.lotNo).join(' ')).toLowerCase()
    case 'party': return (e.lots[0]?.party ?? '').toLowerCase()
    case 'quality': return (e.lots[0]?.quality ?? '').toLowerCase()
    case 'than': return e.totalThan
  }
}

/* ── Finish slip entry types ──────────────────────────────────────── */

interface FinishLot {
  id: number
  lotNo: string
  than: number
  meter: number | null
  doneThan: number
  status: string
  party: string | null
  quality: string | null
  mtrPerThan: number | null
  dyeSlipNo: number | null
  shadeName: string | null
  shadeDesc: string | null
  foldNo: string | null
  dyeSlips: { slipNo: number; shadeName: string | null; shadeDesc: string | null; foldNo: string | null; dyedThan: number }[]
}

interface FinishSlipChemical {
  id: number
  chemicalId: number | null
  chemical: { id: number; name: string } | null
  name: string
  quantity: number | null
  unit: string
  rate: number | null
  cost: number | null
}

interface FinishAdditionChem {
  chemicalId: number | null
  name: string
  quantity: string
  unit: string
}

interface FinishAdditionRow {
  reason: string
  chemicals: FinishAdditionChem[]
}

interface FinishSlipEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  meter: number | null
  mandi: number | null
  opMandi: number | null
  newMandi: number | null
  stockMandi: number | null
  finishThan: number | null
  finishMtr: number | null
  finishDespSlipNo: string | null
  notes: string | null
  lots: FinishLot[]
  chemicals: FinishSlipChemical[]
  additions?: { id: number; reason: string | null; chemicals: { name: string; quantity: number | null; unit: string; chemicalId: number | null }[] }[]
  partyName: string | null
  fpStatus: string
}

type SlipSortField = 'date' | 'slipNo' | 'lotNo' | 'party' | 'than'

function getSlipValue(e: FinishSlipEntry, f: SlipSortField): string | number {
  switch (f) {
    case 'date': return new Date(e.date).getTime()
    case 'slipNo': return e.slipNo
    case 'lotNo': return (e.lots.map(l => l.lotNo).join(' ')).toLowerCase()
    case 'party': return (e.partyName ?? '').toLowerCase()
    case 'than': return e.lots.reduce((s, l) => s + l.than, 0)
  }
}

/* ── Shade display helper ─────────────────────────────────────────── */

function shadeDisplay(name: string | null, desc: string | null) {
  if (!name) return null
  return desc ? `${name} \u2014 ${desc}` : name
}

/* ── Stock Report grouping types ──────────────────────────────────── */

interface SlipDetail {
  id: number
  slipNo: number
  date: string
  shadeName: string | null
  shadeDescription: string | null
  foldNo: string | null
  batchNo: number | null
  lots: StockLot[]
  totalThan: number
  machineName: string | null
  operatorName: string | null
}

interface FoldGroup {
  foldNo: string
  totalThan: number
  slips: SlipDetail[]
}

interface QualityGroup {
  quality: string
  weight: string | null
  totalThan: number
  folds: FoldGroup[]
}

interface PartyGroup {
  party: string
  totalThan: number
  totalSlips: number
  totalLots: number
  qualities: QualityGroup[]
}

/* ── Selected lot for finish ──────────────────────────────────────── */

interface SelectedLot {
  lotNo: string
  than: number
  party: string
  quality: string
  shade: string
  slipNo: number
}

/* ── Packing stock types ──────────────────────────────────────────── */

interface PackingLot {
  lotNo: string
  than: number
  meter: number | null
  party: string | null
  quality: string | null
  weight: string | null
  shadeName: string | null
  shadeDescription: string | null
  foldingReceipts?: { id: number; slipNo: string; date: string; than: number; notes: string | null }[]
  receivedThan?: number
  foldingComplete?: boolean
  foldNo?: string | null
  despatchedThan?: number
}

interface PackingEntry {
  id: number
  slipNo: number
  date: string
  meter: number | null
  mandi: number | null
  notes: string | null
  finishDespSlipNo: string | null
  allFoldingComplete?: boolean
  lots: PackingLot[]
  totalThan: number
  isFromOB?: boolean
  obStage?: string
}

interface PackingPartyGroup {
  party: string
  totalThan: number
  totalSlips: number
  totalLots: number
  qualities: PackingQualityGroup[]
}

interface PackingQualityGroup {
  quality: string
  weight: string | null
  totalThan: number
  slips: PackingSlipDetail[]
}

interface PackingSlipDetail {
  id: number
  slipNo: number
  date: string
  lots: PackingLot[]
  totalThan: number
  meter: number | null
  finishDespSlipNo: string | null
}

/* ── Finish form chemical row type ────────────────────────────────── */

interface ChemicalMaster { id: number; name: string; unit: string; currentPrice: number | null }

interface FinishChemicalRow {
  name: string
  chemicalId: number | null
  quantity: string
  unit: string
  rate: string
  cost: number | null
}

export default function FinishStockPage() {
  const router = useRouter()
  const role = useRole()
  void router

  const { data: rawData, isLoading: loading, mutate: mutateStock } = useSWR<{ stock: StockEntry[]; totalSlips: number; totalThan: number }>('/api/finish/stock', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  const entries = rawData?.stock ?? []

  const { data: packingRaw, isLoading: packingLoading, mutate: mutatePacking } = useSWR<{ stock: PackingEntry[]; totalSlips: number; totalThan: number }>('/api/finish/packing', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  })
  const packingEntries = useMemo(() => packingRaw?.stock ?? [], [packingRaw])

  // Finish slip register data
  const { data: finishSlips, isLoading: slipsLoading, mutate: mutateSlips } = useSWR<FinishSlipEntry[]>('/api/finish', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  const slipEntries = useMemo(() => finishSlips ?? [], [finishSlips])

  // Quality dropdown options (carry-forward + current year)
  const { data: qualityOptions = [] } = useSWR<string[]>('/api/finish/qualities', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })

  // Recipe variants for quality display
  const { data: allRecipes } = useSWR<{ party: { name: string }; quality: { name: string }; variant: string }[]>('/api/finish/recipe', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 120_000,
  })
  const recipeVariantMap = useMemo(() => {
    const m = new Map<string, string>()
    if (!allRecipes) return m
    for (const r of allRecipes) {
      const key = `${r.party.name.toLowerCase().trim()}::${r.quality.name.toLowerCase().trim()}`
      if (!m.has(key) && r.variant) m.set(key, r.variant)
    }
    return m
  }, [allRecipes])

  const [tab, setTab] = useState<Tab>(() => (readViewState(FINISH_VIEW_KEY).tab as Tab) || 'report')

  /* ── Stock Register state ─────────────────────────────────────── */
  const [filterSlip, setFilterSlipRaw] = useState('')
  const [debouncedSlip, setDebouncedSlip] = useDebounce()
  const [filterLot, setFilterLotRaw] = useState('')
  const [debouncedLot, setDebouncedLot] = useDebounce()
  const [filterParty, setFilterPartyRaw] = useState('')
  const [debouncedParty, setDebouncedParty] = useDebounce()
  const [filterQuality, setFilterQualityRaw] = useState('')
  const [debouncedQuality, setDebouncedQuality] = useDebounce()
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // suppress unused warnings
  void filterSlip; void filterLot; void filterParty; void filterQuality

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const fs = debouncedSlip.toLowerCase()
    const fl = debouncedLot.toLowerCase()
    const fp = debouncedParty.toLowerCase()
    const fq = debouncedQuality.toLowerCase()

    return entries
      .filter(e => {
        const allLots = e.lots.map(l => l.lotNo).join(' ').toLowerCase()
        const allParties = e.lots.map(l => l.party ?? '').join(' ').toLowerCase()
        const allQualities = e.lots.map(l => l.quality ?? '').join(' ').toLowerCase()
        const matchSlip = !fs || String(e.slipNo).includes(fs)
        const matchLot = !fl || allLots.includes(fl)
        const matchParty = !fp || allParties.includes(fp)
        const matchQuality = !fq || allQualities.includes(fq)
        return matchSlip && matchLot && matchParty && matchQuality
      })
      .sort((a, b) => {
        const av = getValue(a, sortField), bv = getValue(b, sortField)
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [entries, debouncedSlip, debouncedLot, debouncedParty, debouncedQuality, sortField, sortDir])

  /* ── Finish Slip Register state ────────────────────────────────── */
  const [slipFilterSlip, setSlipFilterSlipRaw] = useState('')
  const [slipDebouncedSlip, setSlipDebouncedSlip] = useDebounce()
  const [slipFilterLot, setSlipFilterLotRaw] = useState('')
  const [slipDebouncedLot, setSlipDebouncedLot] = useDebounce()
  const [slipFilterParty, setSlipFilterPartyRaw] = useState('')
  const [slipDebouncedParty, setSlipDebouncedParty] = useDebounce()
  const [slipSortField, setSlipSortField] = useState<SlipSortField>('date')
  const [slipSortDir, setSlipSortDir] = useState<SortDir>('desc')

  void slipFilterSlip; void slipFilterLot; void slipFilterParty

  const toggleSlipSort = (f: SlipSortField) => {
    if (slipSortField === f) setSlipSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSlipSortField(f); setSlipSortDir('asc') }
  }

  const filteredSlips = useMemo(() => {
    const fs = slipDebouncedSlip.toLowerCase()
    const fl = slipDebouncedLot.toLowerCase()
    const fp = slipDebouncedParty.toLowerCase()

    return slipEntries
      .filter(e => {
        const allLots = e.lots.map(l => l.lotNo).join(' ').toLowerCase()
        const matchSlip = !fs || String(e.slipNo).includes(fs)
        const matchLot = !fl || allLots.includes(fl)
        const matchParty = !fp || (e.partyName ?? '').toLowerCase().includes(fp)
        return matchSlip && matchLot && matchParty
      })
      .sort((a, b) => {
        const av = getSlipValue(a, slipSortField), bv = getSlipValue(b, slipSortField)
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return slipSortDir === 'asc' ? cmp : -cmp
      })
  }, [slipEntries, slipDebouncedSlip, slipDebouncedLot, slipDebouncedParty, slipSortField, slipSortDir])

  /* ── Shared chemical master state ──────────────────────────────── */
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])
  const [chemLoaded, setChemLoaded] = useState(false)

  /* ── Finish Slip Edit state ──────────────────────────────────────── */
  const [editingSlipId, setEditingSlipId] = useState<number | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editSlipNo, setEditSlipNo] = useState('')
  const [editMandi, setEditMandi] = useState('')
  const [editOpMandi, setEditOpMandi] = useState('')
  const [editNewMandi, setEditNewMandi] = useState('')
  const [editStockMandi, setEditStockMandi] = useState('')
  const [editFinishThan, setEditFinishThan] = useState('')
  const [editFinishMtr, setEditFinishMtr] = useState('')
  const [editDespSlipNo, setEditDespSlipNo] = useState('')
  const [editAdditions, setEditAdditions] = useState<FinishAdditionRow[]>([])
  const [editNotes, setEditNotes] = useState('')
  const [editLots, setEditLots] = useState<{ lotNo: string; than: string; meter: string; slipThans?: { slipNo: number; than: string; shade: string }[] }[]>([])
  const [editChemicals, setEditChemicals] = useState<FinishChemicalRow[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [expandedFPs, setExpandedFPs] = useState<Set<number>>(new Set())
  const [partialLotId, setPartialLotId] = useState<number | null>(null)
  const [partialThanInput, setPartialThanInput] = useState('')
  const [lotUpdating, setLotUpdating] = useState<number | null>(null)

  const toggleFP = (id: number) => {
    setExpandedFPs(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function updateLotStatus(lotId: number, status: string, doneThan?: number) {
    setLotUpdating(lotId)
    try {
      const res = await fetch('/api/finish/lot-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotId, status, doneThan }),
      })
      if (res.ok) {
        mutateSlips()
        mutatePacking()
        setPartialLotId(null)
        setPartialThanInput('')
      }
    } catch {}
    setLotUpdating(null)
  }

  const startEdit = useCallback(async (entry: FinishSlipEntry) => {
    setEditingSlipId(entry.id)
    setEditDate(new Date(entry.date).toISOString().split('T')[0])
    setEditSlipNo(String(entry.slipNo))
    setEditMandi(entry.mandi != null ? String(entry.mandi) : '')
    setEditOpMandi(entry.opMandi != null ? String(entry.opMandi) : '')
    setEditNewMandi(entry.newMandi != null ? String(entry.newMandi) : '')
    setEditStockMandi(entry.stockMandi != null ? String(entry.stockMandi) : '')
    setEditFinishThan(entry.finishThan != null ? String(entry.finishThan) : '')
    setEditFinishMtr(entry.finishMtr != null ? String(entry.finishMtr) : '')
    setEditDespSlipNo(entry.finishDespSlipNo || '')
    setEditAdditions((entry.additions || []).map(a => ({
      reason: a.reason || '',
      chemicals: a.chemicals.map(c => ({
        chemicalId: c.chemicalId,
        name: c.name,
        quantity: c.quantity != null ? String(c.quantity) : '',
        unit: c.unit,
      })),
    })))
    setEditNotes(entry.notes ?? '')
    setEditLots(entry.lots.map(l => {
      const dyeSlips = l.dyeSlips?.length
        ? l.dyeSlips.map((ds: any) => ({
            slipNo: ds.slipNo,
            than: String(ds.dyedThan || 0),
            shade: [ds.shadeName, ds.shadeDesc].filter(Boolean).join(' — '),
          }))
        : []
      const savedThan = l.than ?? 0
      const dyeSum = dyeSlips.reduce((s, st) => s + (parseInt(st.than) || 0), 0)
      // Only show per-slip breakdown when it still matches the saved total.
      // Otherwise the user has deliberately set a different value — trust the
      // DB, hide the (now outdated) breakdown so it doesn't re-override on save.
      const useBreakdown = dyeSlips.length > 0 && dyeSum === savedThan
      return {
        lotNo: l.lotNo,
        than: String(savedThan),
        meter: l.meter != null ? String(l.meter) : '',
        slipThans: useBreakdown ? dyeSlips : [],
      }
    }))
    setEditChemicals(entry.chemicals.map(c => ({
      name: c.name,
      chemicalId: c.chemicalId,
      quantity: c.quantity != null ? String(c.quantity) : '',
      unit: c.unit,
      rate: c.rate != null ? String(c.rate) : '',
      cost: c.cost,
    })))
    setEditError('')
    // Load chemicals master if not loaded
    if (!chemLoaded) {
      try {
        const res = await fetch('/api/chemicals')
        const data = await res.json()
        setMasterChemicals(Array.isArray(data) ? data : [])
        setChemLoaded(true)
      } catch { /* ignore */ }
    }
  }, [chemLoaded])

  const cancelEdit = useCallback(() => {
    setEditingSlipId(null)
    setEditChemicals([])
    setEditLots([])
    setEditAdditions([])
    setEditError('')
  }, [])

  const [editRecipeLoading, setEditRecipeLoading] = useState(false)
  const [editRecipeMsg, setEditRecipeMsg] = useState('')
  const [showEditRecipePicker, setShowEditRecipePicker] = useState(false)
  const [editRecipePickerList, setEditRecipePickerList] = useState<any[]>([])
  const [editRecipePickerParty, setEditRecipePickerParty] = useState('')

  const editLoadRecipe = useCallback(async (entry: any) => {
    const partyName = entry.lots?.[0]?.party
    if (!partyName || partyName === 'Unknown') {
      setEditRecipeMsg('Could not determine party from lots.')
      return
    }
    setEditRecipeLoading(true)
    setEditRecipeMsg('')
    try {
      const partiesRes = await fetch('/api/masters/parties').then(r => r.json())
      const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')
      const party = (partiesRes as any[]).find((p: any) => norm(p.name) === norm(partyName))
      if (!party) { setEditRecipeMsg(`No party found: ${partyName}`); setEditRecipeLoading(false); return }
      const recipesRes = await fetch(`/api/finish/recipe?partyId=${party.id}`)
      const recipes = await recipesRes.json()
      if (!Array.isArray(recipes) || recipes.length === 0) {
        setEditRecipeMsg(`No recipes for ${partyName}`)
        setEditRecipeLoading(false)
        return
      }
      setEditRecipePickerList(recipes)
      setEditRecipePickerParty(partyName)
      setShowEditRecipePicker(true)
    } catch {
      setEditRecipeMsg('Failed to fetch recipes.')
    }
    setEditRecipeLoading(false)
  }, [])

  const applyEditRecipe = useCallback((recipe: any) => {
    const newChemicals: FinishChemicalRow[] = recipe.items.map((item: any) => {
      const rate = item.chemical?.currentPrice
      const qty = item.quantity
      const cost = rate != null && qty != null ? parseFloat((qty * rate).toFixed(2)) : null
      return { name: item.name, chemicalId: item.chemicalId, quantity: String(item.quantity), unit: item.unit, rate: rate != null ? String(rate) : '', cost }
    })
    setEditChemicals(newChemicals)
    setShowEditRecipePicker(false)
    const variantNote = recipe.variant && recipe.variant !== 'Standard' ? ` (${recipe.variant})` : ''
    setEditRecipeMsg(`Loaded: ${recipe.quality.name}${variantNote} — ${recipe.items.length} chemical(s)`)
  }, [])

  const addEditChemical = useCallback(() => {
    setEditChemicals(prev => [...prev, { name: '', chemicalId: null, quantity: '', unit: 'kg', rate: '', cost: null }])
  }, [])

  const removeEditChemical = useCallback((i: number) => {
    setEditChemicals(prev => prev.filter((_, idx) => idx !== i))
  }, [])

  const updateEditChemical = useCallback((i: number, field: keyof FinishChemicalRow, value: string) => {
    setEditChemicals(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }
      if (field === 'name') {
        const exact = masterChemicals.find(m => m.name.toLowerCase().trim() === value.toLowerCase().trim())
        updated[i].chemicalId = exact?.id ?? null
        if (exact?.currentPrice != null) updated[i].rate = String(exact.currentPrice)
      }
      const qty = parseFloat(field === 'quantity' ? value : updated[i].quantity)
      const rate = parseFloat(field === 'rate' ? value : updated[i].rate)
      updated[i].cost = !isNaN(qty) && !isNaN(rate) ? parseFloat((qty * rate).toFixed(2)) : null
      return updated
    })
  }, [masterChemicals])

  const handleEditSubmit = useCallback(async () => {
    if (!editingSlipId) return
    if (!editSlipNo.trim()) { setEditError('Finish_Prg No is required.'); return }
    setEditSaving(true)
    setEditError('')

    const totalMeter = editLots.reduce((s, l) => s + (parseFloat(l.meter) || 0), 0)

    const payload = {
      date: editDate,
      slipNo: editSlipNo,
      notes: editNotes || null,
      mandi: editMandi ? parseFloat(editMandi) : null,
      opMandi: editOpMandi ? parseFloat(editOpMandi) : null,
      newMandi: editNewMandi ? parseFloat(editNewMandi) : null,
      stockMandi: editStockMandi ? parseFloat(editStockMandi) : null,
      finishThan: editFinishThan ? parseInt(editFinishThan) : null,
      finishMtr: editFinishMtr ? parseFloat(editFinishMtr) : null,
      finishDespSlipNo: editDespSlipNo || null,
      totalMeter: totalMeter || null,
      lots: editLots.map(l => ({
        lotNo: l.lotNo.trim(),
        than: parseInt(l.than) || 0,
        meter: l.meter ? parseFloat(l.meter) : null,
      })),
      chemicals: editChemicals
        .filter(c => c.name.trim())
        .map(c => ({
          name: c.name.trim(),
          chemicalId: c.chemicalId,
          quantity: c.quantity ? parseFloat(c.quantity) : null,
          unit: c.unit,
          rate: c.rate ? parseFloat(c.rate) : null,
          cost: c.cost,
        })),
      additions: editAdditions.map(a => ({
        reason: a.reason || null,
        chemicals: a.chemicals.map(c => ({
          chemicalId: c.chemicalId,
          name: c.name,
          quantity: c.quantity || null,
          unit: c.unit,
        })),
      })),
    }

    try {
      const res = await fetch(`/api/finish/${editingSlipId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setEditingSlipId(null)
        setEditChemicals([])
        setEditLots([])
        mutateSlips()
        mutateStock()
        mutatePacking()
      } else {
        const d = await res.json().catch(() => ({}))
        setEditError(d.error ?? 'Failed to save')
      }
    } catch {
      setEditError('Network error')
    }
    setEditSaving(false)
  }, [editingSlipId, editDate, editSlipNo, editNotes, editMandi, editOpMandi, editNewMandi, editStockMandi, editFinishThan, editFinishMtr, editDespSlipNo, editLots, editChemicals, editAdditions, mutateSlips, mutateStock])

  const handleDelete = useCallback(async (id: number) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/finish/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setDeleteConfirmId(null)
        mutateSlips()
        mutateStock()
        mutatePacking()
      }
    } catch { /* ignore */ }
    setDeleting(false)
  }, [mutateSlips, mutateStock])

  /* ── Stock Report grouped data ──────────────────────────────────── */

  const partyGroups = useMemo<PartyGroup[]>(() => {
    // Flatten: for each entry, for each lot, produce a record
    const records: { party: string; quality: string; weight: string | null; foldNo: string; slip: SlipDetail; lotNo: string; than: number }[] = []
    for (const e of entries) {
      for (const l of e.lots) {
        records.push({
          party: l.party ?? 'Unknown',
          quality: l.quality ?? 'Unknown',
          weight: l.weight,
          foldNo: e.foldNo ?? 'No Fold',
          slip: e,
          lotNo: l.lotNo,
          than: l.than,
        })
      }
    }

    // Group by party → quality → fold
    type FoldData = { slipSet: Set<number>; slips: Map<number, SlipDetail>; totalThan: number }
    type QualityData = { weight: string | null; folds: Map<string, FoldData>; totalThan: number; slipSet: Set<number>; lotSet: Set<string> }
    const partyMap = new Map<string, Map<string, QualityData>>()

    for (const r of records) {
      if (!partyMap.has(r.party)) partyMap.set(r.party, new Map())
      const qMap = partyMap.get(r.party)!
      if (!qMap.has(r.quality)) qMap.set(r.quality, { weight: r.weight, folds: new Map(), totalThan: 0, slipSet: new Set(), lotSet: new Set() })
      const qg = qMap.get(r.quality)!
      qg.totalThan += r.than
      qg.lotSet.add(r.lotNo)
      qg.slipSet.add(r.slip.id)

      if (!qg.folds.has(r.foldNo)) qg.folds.set(r.foldNo, { slipSet: new Set(), slips: new Map(), totalThan: 0 })
      const fg = qg.folds.get(r.foldNo)!
      fg.totalThan += r.than
      fg.slipSet.add(r.slip.id)
      if (!fg.slips.has(r.slip.id)) fg.slips.set(r.slip.id, r.slip)
    }

    const result: PartyGroup[] = []
    for (const [party, qMap] of partyMap) {
      const qualities: QualityGroup[] = []
      let totalThan = 0
      let totalSlips = 0
      const lotSet = new Set<string>()
      for (const [quality, data] of qMap) {
        const folds: FoldGroup[] = []
        for (const [foldNo, fd] of data.folds) {
          folds.push({
            foldNo,
            totalThan: fd.totalThan,
            slips: Array.from(fd.slips.values()).sort((a, b) => a.slipNo - b.slipNo),
          })
        }
        folds.sort((a, b) => a.foldNo.localeCompare(b.foldNo))
        qualities.push({ quality, weight: data.weight, totalThan: data.totalThan, folds })
        totalThan += data.totalThan
        totalSlips += data.slipSet.size
        data.lotSet.forEach(l => lotSet.add(l))
      }
      qualities.sort((a, b) => a.quality.localeCompare(b.quality))
      result.push({ party, totalThan, totalSlips, totalLots: lotSet.size, qualities })
    }
    result.sort((a, b) => a.party.localeCompare(b.party))
    return result
  }, [entries])

  /* ── Stock Report expand state ─────────────────────────────────── */
  const [expandedParties, setExpandedParties] = useState<Set<string>>(new Set())
  const [expandedQualities, setExpandedQualities] = useState<Set<string>>(new Set())
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(new Set())
  const [reportSearch, setReportSearch] = useState('')

  const toggleParty = (party: string) => {
    setExpandedParties(prev => {
      const next = new Set(prev)
      if (next.has(party)) next.delete(party); else next.add(party)
      return next
    })
  }
  const toggleQuality = (key: string) => {
    setExpandedQualities(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const toggleFold = (key: string) => {
    setExpandedFolds(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const totalThan = useMemo(() => entries.reduce((s, e) => s + e.totalThan, 0), [entries])

  /* ── Selection state for Stock Report ──────────────────────────── */

  const [selectedLots, setSelectedLots] = useState<Map<string, SelectedLot>>(new Map())
  const [showFinishForm, setShowFinishForm] = useState(false)

  // Build a flat list of all lots for "Select All" logic
  const allReportLots = useMemo(() => {
    const lots: SelectedLot[] = []
    for (const e of entries) {
      for (const l of e.lots) {
        lots.push({
          lotNo: l.lotNo,
          than: l.than,
          party: l.party ?? 'Unknown',
          quality: l.quality ?? 'Unknown',
          shade: shadeDisplay(e.shadeName, e.shadeDescription) ?? '',
          slipNo: e.slipNo,
        })
      }
    }
    return lots
  }, [entries])

  const lotKey = (lot: SelectedLot) => `${lot.slipNo}|${lot.lotNo}`

  // Report tab: filter partyGroups by search term (party / quality / lot)
  const filteredPartyGroups = useMemo(() => {
    const q = reportSearch.toLowerCase().trim()
    if (!q) return partyGroups
    const result: PartyGroup[] = []
    for (const pg of partyGroups) {
      const partyMatch = pg.party.toLowerCase().includes(q)
      const keptQualities = pg.qualities.map(qg => {
        const qualityMatch = qg.quality.toLowerCase().includes(q)
        const keptFolds = qg.folds.map(fg => {
          const foldSlips = fg.slips.filter(s => s.lots.some(l => l.lotNo.toLowerCase().includes(q)))
          if (partyMatch || qualityMatch) return fg
          if (foldSlips.length === 0) return null
          return { ...fg, slips: foldSlips, totalThan: foldSlips.reduce((s, x) => s + x.lots.reduce((ss, l) => ss + l.than, 0), 0) }
        }).filter(Boolean) as typeof qg.folds
        if (partyMatch || qualityMatch || keptFolds.length > 0) {
          return { ...qg, folds: keptFolds.length > 0 ? keptFolds : qg.folds }
        }
        return null
      }).filter(Boolean) as typeof pg.qualities
      if (partyMatch || keptQualities.length > 0) {
        result.push({ ...pg, qualities: keptQualities.length > 0 ? keptQualities : pg.qualities })
      }
    }
    return result
  }, [partyGroups, reportSearch])

  // Auto-expand matching groups when user searches
  useEffect(() => {
    const q = reportSearch.toLowerCase().trim()
    if (!q) return
    const partiesToOpen = new Set<string>()
    const qualitiesToOpen = new Set<string>()
    const foldsToOpen = new Set<string>()
    for (const pg of partyGroups) {
      const partyMatch = pg.party.toLowerCase().includes(q)
      for (const qg of pg.qualities) {
        const qualityMatch = qg.quality.toLowerCase().includes(q)
        const qKey = `${pg.party}::${qg.quality}`
        for (const fg of qg.folds) {
          const fKey = `${pg.party}::${qg.quality}::${fg.foldNo}`
          const lotMatch = fg.slips.some(s => s.lots.some(l => l.lotNo.toLowerCase().includes(q)))
          if (partyMatch || qualityMatch || lotMatch) {
            partiesToOpen.add(pg.party)
            qualitiesToOpen.add(qKey)
            if (lotMatch) foldsToOpen.add(fKey)
          }
        }
      }
    }
    setExpandedParties(prev => new Set([...prev, ...partiesToOpen]))
    setExpandedQualities(prev => new Set([...prev, ...qualitiesToOpen]))
    setExpandedFolds(prev => new Set([...prev, ...foldsToOpen]))
  }, [reportSearch, partyGroups])

  const toggleLotSelection = useCallback((lot: SelectedLot) => {
    const key = `${lot.slipNo}|${lot.lotNo}`
    setSelectedLots(prev => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, lot)
      return next
    })
  }, [])

  const togglePartySelection = useCallback((partyName: string) => {
    const partyLots = allReportLots.filter(l => l.party === partyName)
    setSelectedLots(prev => {
      const next = new Map(prev)
      const allSelected = partyLots.every(l => next.has(lotKey(l)))
      if (allSelected) {
        partyLots.forEach(l => next.delete(lotKey(l)))
      } else {
        partyLots.forEach(l => next.set(lotKey(l), l))
      }
      return next
    })
  }, [allReportLots])

  const toggleSelectAll = useCallback(() => {
    setSelectedLots(prev => {
      if (prev.size === allReportLots.length && allReportLots.length > 0) {
        return new Map()
      }
      const next = new Map<string, SelectedLot>()
      allReportLots.forEach(l => next.set(lotKey(l), l))
      return next
    })
  }, [allReportLots])

  const selectedThan = useMemo(() => {
    let t = 0
    for (const l of selectedLots.values()) t += l.than
    return t
  }, [selectedLots])

  /* ── Finish Form state (inline) ────────────────────────────────── */

  const [finishDate, setFinishDate] = useState(new Date().toISOString().split('T')[0])
  const [finishSlipNo, setFinishSlipNo] = useState('')
  const [finishMandi, setFinishMandi] = useState('')
  const [finishNotes, setFinishNotes] = useState('')
  const [finishMeters, setFinishMeters] = useState<Record<string, string>>({})
  const [finishThanOverrides, setFinishThanOverrides] = useState<Record<string, string>>({})
  const [finishChemicals, setFinishChemicals] = useState<FinishChemicalRow[]>([])
  const [finishSaving, setFinishSaving] = useState(false)
  const [finishError, setFinishError] = useState('')
  const [finishTotalMeterOverride, setFinishTotalMeterOverride] = useState('')
  const [recipeFetching, setRecipeFetching] = useState(false)
  const [recipeMsg, setRecipeMsg] = useState('')
  const [showRecipePicker, setShowRecipePicker] = useState(false)
  const [recipePickerList, setRecipePickerList] = useState<any[]>([])
  const [recipePickerParty, setRecipePickerParty] = useState('')

  const startFinish = useCallback(async () => {
    setShowFinishForm(true)
    setFinishError('')
    // Auto-increment slip no
    try {
      const res = await fetch('/api/finish')
      const data = await res.json()
      const maxSlip = Array.isArray(data) ? data.reduce((m: number, e: any) => Math.max(m, e.slipNo || 0), 0) : 0
      setFinishSlipNo(String(maxSlip + 1))
    } catch {
      setFinishSlipNo('')
    }
    // Auto-fill meters from mtrPerThan
    const autoMeters: Record<string, string> = {}
    const grouped = new Map<string, { lotNo: string; totalThan: number; mtrPerThan: number | null }>()
    for (const lot of selectedLots.values()) {
      if (!grouped.has(lot.lotNo)) grouped.set(lot.lotNo, { lotNo: lot.lotNo, totalThan: 0, mtrPerThan: null })
      const g = grouped.get(lot.lotNo)!
      g.totalThan += lot.than
    }
    // Find mtrPerThan from stock entries
    for (const e of entries) {
      for (const l of e.lots) {
        const g = grouped.get(l.lotNo)
        if (g && l.mtrPerThan && !g.mtrPerThan) g.mtrPerThan = l.mtrPerThan
      }
    }
    for (const [lotNo, g] of grouped) {
      if (g.mtrPerThan && g.totalThan > 0) {
        autoMeters[lotNo] = (g.mtrPerThan * g.totalThan).toFixed(1)
      }
    }
    if (Object.keys(autoMeters).length > 0) setFinishMeters(autoMeters)

    // Load chemicals master
    if (!chemLoaded) {
      try {
        const res = await fetch('/api/chemicals')
        const data = await res.json()
        setMasterChemicals(Array.isArray(data) ? data : [])
        setChemLoaded(true)
      } catch { /* ignore */ }
    }
  }, [chemLoaded, selectedLots, entries])

  const cancelFinish = useCallback(() => {
    setShowFinishForm(false)
    setFinishChemicals([])
    setFinishMeters({})
    setFinishThanOverrides({})
    setFinishMandi('')
    setFinishNotes('')
    setFinishError('')
    setFinishTotalMeterOverride('')
    setRecipeMsg('')
  }, [])

  const fetchFinishRecipe = useCallback(async () => {
    const firstLot = Array.from(selectedLots.values())[0]
    if (!firstLot) { setRecipeMsg('No lots selected.'); return }
    const partyName = firstLot.party
    if (!partyName || partyName === 'Unknown') {
      setRecipeMsg('Could not determine party from selected lots.')
      return
    }
    setRecipeFetching(true)
    setRecipeMsg('')
    try {
      const partiesRes = await fetch('/api/masters/parties').then(r => r.json())
      const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')
      const party = (partiesRes as any[]).find((p: any) => norm(p.name) === norm(partyName))
      if (!party) {
        setRecipeMsg(`No party found: ${partyName}`)
        setRecipeFetching(false)
        return
      }
      const recipesRes = await fetch(`/api/finish/recipe?partyId=${party.id}`)
      const recipes = await recipesRes.json()
      if (!Array.isArray(recipes) || recipes.length === 0) {
        setRecipeMsg(`No recipes found for ${partyName}`)
        setRecipeFetching(false)
        return
      }
      setRecipePickerList(recipes)
      setRecipePickerParty(partyName)
      setShowRecipePicker(true)
    } catch {
      setRecipeMsg('Failed to fetch recipes.')
    }
    setRecipeFetching(false)
  }, [selectedLots])

  const applyRecipe = useCallback((recipe: any) => {
    const newChemicals: FinishChemicalRow[] = recipe.items.map((item: any) => {
      const rate = item.chemical?.currentPrice
      const qty = item.quantity
      const cost = rate != null && qty != null ? parseFloat((qty * rate).toFixed(2)) : null
      return {
        name: item.name,
        chemicalId: item.chemicalId,
        quantity: String(item.quantity),
        unit: item.unit,
        rate: rate != null ? String(rate) : '',
        cost,
      }
    })
    setFinishChemicals(newChemicals)
    setShowRecipePicker(false)
    const variantNote = recipe.variant && recipe.variant !== 'Standard' ? ` (${recipe.variant})` : ''
    setRecipeMsg(`Loaded: ${recipe.quality.name}${variantNote} — ${recipe.items.length} chemical(s)`)
  }, [])

  const addFinishChemical = useCallback(() => {
    setFinishChemicals(prev => [...prev, { name: '', chemicalId: null, quantity: '', unit: 'kg', rate: '', cost: null }])
  }, [])

  const removeFinishChemical = useCallback((i: number) => {
    setFinishChemicals(prev => prev.filter((_, idx) => idx !== i))
  }, [])

  const updateFinishChemical = useCallback((i: number, field: keyof FinishChemicalRow, value: string) => {
    setFinishChemicals(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }
      if (field === 'name') {
        const exact = masterChemicals.find(m => m.name.toLowerCase().trim() === value.toLowerCase().trim())
        updated[i].chemicalId = exact?.id ?? null
        if (exact?.currentPrice != null) updated[i].rate = String(exact.currentPrice)
      }
      const qty = parseFloat(field === 'quantity' ? value : updated[i].quantity)
      const rate = parseFloat(field === 'rate' ? value : updated[i].rate)
      updated[i].cost = !isNaN(qty) && !isNaN(rate) ? parseFloat((qty * rate).toFixed(2)) : null
      return updated
    })
  }, [masterChemicals])

  const selectFinishChemicalMaster = useCallback((i: number, master: ChemicalMaster) => {
    setFinishChemicals(prev => {
      const updated = [...prev]
      updated[i] = {
        ...updated[i],
        name: master.name,
        chemicalId: master.id,
        rate: master.currentPrice?.toString() ?? updated[i].rate,
      }
      const qty = parseFloat(updated[i].quantity)
      const rate = parseFloat(updated[i].rate)
      updated[i].cost = !isNaN(qty) && !isNaN(rate) ? parseFloat((qty * rate).toFixed(2)) : null
      return updated
    })
  }, [])

  const handleFinishSubmit = useCallback(async () => {
    if (selectedLots.size === 0) return
    if (!finishSlipNo.trim()) { setFinishError('Finish_Prg No is required.'); return }
    setFinishSaving(true)
    setFinishError('')

    // Group selected lots by lotNo and sum than (with overrides)
    const lotMap = new Map<string, { lotNo: string; than: number }>()
    for (const l of selectedLots.values()) {
      const overrideKey = `${l.slipNo}::${l.lotNo}`
      const overrideThan = finishThanOverrides[overrideKey] ? parseInt(finishThanOverrides[overrideKey]) : l.than
      const existing = lotMap.get(l.lotNo)
      if (existing) existing.than += overrideThan
      else lotMap.set(l.lotNo, { lotNo: l.lotNo, than: overrideThan })
    }
    const lots = Array.from(lotMap.values())
    const marka = lots.map(l => ({
      lotNo: l.lotNo.trim(),
      than: l.than,
      meter: finishMeters[l.lotNo] ? parseFloat(finishMeters[l.lotNo]) : null,
    }))

    const autoMeter = marka.reduce((s, l) => s + (l.meter || 0), 0)
    const totalMeter = finishTotalMeterOverride ? parseFloat(finishTotalMeterOverride) : autoMeter

    const payload = {
      date: finishDate,
      slipNo: finishSlipNo,
      notes: finishNotes || null,
      mandi: finishMandi ? parseFloat(finishMandi) : null,
      lotNo: lots[0].lotNo,
      than: String(lots[0].than),
      totalMeter: totalMeter || null,
      marka,
      chemicals: finishChemicals
        .filter(c => c.name.trim())
        .map(c => ({
          name: c.name.trim(),
          chemicalId: c.chemicalId,
          quantity: c.quantity ? parseFloat(c.quantity) : null,
          unit: c.unit,
          rate: c.rate ? parseFloat(c.rate) : null,
          cost: c.cost,
        })),
    }

    try {
      const res = await fetch('/api/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setShowFinishForm(false)
        setSelectedLots(new Map())
        setFinishChemicals([])
        setFinishMeters({})
        setFinishThanOverrides({})
        setFinishMandi('')
        setFinishNotes('')
        setFinishSaving(false)
        // Live refresh data
        mutateSlips()
        mutateStock()
        mutatePacking()
        return
      } else {
        const d = await res.json().catch(() => ({}))
        setFinishError(d.error ?? 'Failed to save')
        setFinishSaving(false)
      }
    } catch {
      setFinishError('Network error')
      setFinishSaving(false)
    }
  }, [selectedLots, finishDate, finishSlipNo, finishNotes, finishMandi, finishMeters, finishChemicals, finishTotalMeterOverride, mutateSlips, mutateStock])

  /* ── Packing Stock grouped data ────────────────────────────────── */

  const packingPartyGroups = useMemo<PackingPartyGroup[]>(() => {
    const records: { party: string; quality: string; weight: string | null; slip: PackingSlipDetail; lotNo: string; than: number }[] = []
    for (const pe of packingEntries) {
      for (const l of pe.lots) {
        // Show balance (= packed than − received in folding − despatched)
        // so quality/party totals reflect what's still pending in folding,
        // not the original finish-program allocation.
        const recs = (l as any).foldingReceipts || []
        const received = recs.reduce((s: number, r: any) => s + r.than, 0)
        const despatched = (l as any).despatchedThan || 0
        const balance = Math.max(0, l.than - received - despatched)
        if (balance <= 0) continue
        records.push({
          party: l.party ?? 'Unknown',
          quality: l.quality ?? 'Unknown',
          weight: l.weight,
          slip: { id: pe.id, slipNo: pe.slipNo, date: pe.date, lots: pe.lots, totalThan: pe.totalThan, meter: pe.meter, finishDespSlipNo: pe.finishDespSlipNo },
          lotNo: l.lotNo,
          than: balance,
        })
      }
    }

    const partyMap = new Map<string, Map<string, { weight: string | null; slipSet: Set<number>; slips: Map<number, PackingSlipDetail>; totalThan: number; lotSet: Set<string> }>>()
    for (const r of records) {
      if (!partyMap.has(r.party)) partyMap.set(r.party, new Map())
      const qMap = partyMap.get(r.party)!
      if (!qMap.has(r.quality)) qMap.set(r.quality, { weight: r.weight, slipSet: new Set(), slips: new Map(), totalThan: 0, lotSet: new Set() })
      const qg = qMap.get(r.quality)!
      qg.totalThan += r.than
      qg.lotSet.add(r.lotNo)
      qg.slipSet.add(r.slip.id)
      if (!qg.slips.has(r.slip.id)) qg.slips.set(r.slip.id, r.slip)
    }

    const result: PackingPartyGroup[] = []
    for (const [party, qMap] of partyMap) {
      const qualities: PackingQualityGroup[] = []
      let totalThan = 0
      let totalSlips = 0
      const lotSet = new Set<string>()
      for (const [quality, data] of qMap) {
        qualities.push({
          quality,
          weight: data.weight,
          totalThan: data.totalThan,
          slips: Array.from(data.slips.values()).sort((a, b) => a.slipNo - b.slipNo),
        })
        totalThan += data.totalThan
        totalSlips += data.slipSet.size
        data.lotSet.forEach(l => lotSet.add(l))
      }
      qualities.sort((a, b) => a.quality.localeCompare(b.quality))
      result.push({ party, totalThan, totalSlips, totalLots: lotSet.size, qualities })
    }
    result.sort((a, b) => a.party.localeCompare(b.party))
    return result
  }, [packingEntries])

  /* ── Packing expand state ──────────────────────────────────────── */
  const [packExpandedParties, setPackExpandedParties] = useState<Set<string>>(() => {
    const arr = readViewState(FINISH_VIEW_KEY).packExpandedParties
    return new Set(Array.isArray(arr) ? arr : [])
  })
  const [packExpandedQualities, setPackExpandedQualities] = useState<Set<string>>(() => {
    const arr = readViewState(FINISH_VIEW_KEY).packExpandedQualities
    return new Set(Array.isArray(arr) ? arr : [])
  })
  const [packView, setPackView] = useState<'party' | 'desp'>(
    () => (readViewState(FINISH_VIEW_KEY).packView === 'desp' ? 'desp' : 'party')
  )
  const [frSearch, setFrSearch] = useState('')
  const [frSortDir, setFrSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedDesp, setExpandedDesp] = useState<Set<string>>(() => {
    const arr = readViewState(FINISH_VIEW_KEY).expandedDesp
    return new Set(Array.isArray(arr) ? arr : [])
  })
  const [selectedDesps, setSelectedDesps] = useState<Set<string>>(new Set())

  // Persist collapse/tab state so it survives a nav to /lot/[id] and back.
  useEffect(() => {
    persistViewState(FINISH_VIEW_KEY, {
      tab, packView,
      expandedDesp: [...expandedDesp],
      packExpandedParties: [...packExpandedParties],
      packExpandedQualities: [...packExpandedQualities],
    })
  }, [tab, packView, expandedDesp, packExpandedParties, packExpandedQualities])

  // Restore scroll + ring-highlight the clicked lot card after back-nav (both views).
  useLotBackHighlight(FINISH_VIEW_KEY, tab === 'packing' && (packView === 'desp' || packView === 'party'))
  const [despSearch, setDespSearch] = useState('')

  function toggleDespSelect(despNo: string) {
    setSelectedDesps(prev => { const n = new Set(prev); if (n.has(despNo)) n.delete(despNo); else n.add(despNo); return n })
  }

  function shareDespSlips() {
    const despMap = new Map<string, typeof packingEntries>()
    for (const pe of packingEntries) {
      const key = pe.finishDespSlipNo || 'No Desp Slip'
      if (!selectedDesps.has(key)) continue
      if (!despMap.has(key)) despMap.set(key, [])
      despMap.get(key)!.push(pe)
    }
    let text = '📋 *Finish Despatch Report*\n━━━━━━━━━━━━━━━━━━━━\n'
    for (const [despNo, entries] of despMap) {
      text += `\n📦 *Desp Slip: ${despNo}*\n┌──────────────────────\n`
      for (const pe of entries) {
        text += `│ *Finish_Prg ${pe.slipNo}* · ${new Date(pe.date).toLocaleDateString('en-IN')}\n│\n`
        for (const l of pe.lots) {
          const recs = (l as any).foldingReceipts || []
          const received = recs.reduce((s: number, r: any) => s + r.than, 0)
          const frStatus = received >= l.than ? '✅' : `⏳ ${received}/${l.than}`
          text += `│   🏷️ ${l.lotNo} · ${l.than} · ${frStatus}\n`
        }
        const qualities = [...new Set(pe.lots.map((l: any) => l.quality).filter(Boolean))]
        if (qualities.length > 0) text += `│ Quality: ${qualities.join(', ')}\n`
        const totalReceived = pe.lots.reduce((s: number, l: any) => s + ((l.foldingReceipts || []).reduce((s2: number, r: any) => s2 + r.than, 0)), 0)
        text += `│ Total: ${pe.totalThan} · FR: ${totalReceived}/${pe.totalThan}\n`
      }
      text += `└──────────────────────\n`
    }
    const grandTotal = Array.from(despMap.values()).flat().reduce((s, e) => s + e.totalThan, 0)
    text += `\n*Total: ${selectedDesps.size} slips · ${grandTotal}*`

    if (navigator.share) {
      navigator.share({ text }).catch(() => {})
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    }
  }
  const [frFormLotId, setFrFormLotId] = useState<number | null>(null)
  const [frFormLotNo, setFrFormLotNo] = useState('')
  const [frFormFpNo, setFrFormFpNo] = useState<number | null>(null)
  const [frFormMaxThan, setFrFormMaxThan] = useState(0)
  const [frSlipNo, setFrSlipNo] = useState('')
  const [frDate, setFrDate] = useState(new Date().toISOString().split('T')[0])
  const [frThan, setFrThan] = useState('')
  const [frSaving, setFrSaving] = useState(false)
  const [frEditId, setFrEditId] = useState<number | null>(null)
  const [frEditThan, setFrEditThan] = useState('')
  const [showAddLot, setShowAddLot] = useState(false)
  const [addLotSearch, setAddLotSearch] = useState('')

  async function addFoldingReceipt() {
    if (!frFormLotId || !frSlipNo || !frThan) return
    setFrSaving(true)
    const body: any = { slipNo: frSlipNo, date: frDate, than: frThan }
    if (frFormLotId > 0) {
      body.lotEntryId = frFormLotId
    } else {
      body.obLotNo = frFormLotNo
      body.obThan = frFormMaxThan
    }
    await fetch('/api/finish/folding-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setFrSaving(false); setFrFormLotId(null); setFrFormLotNo(''); setFrFormFpNo(null); setFrFormMaxThan(0); setFrThan(''); setFrSlipNo('')
    mutatePacking()
  }

  async function editFoldingReceipt() {
    if (!frEditId || !frEditThan) return
    await fetch('/api/finish/folding-receipt', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: frEditId, than: frEditThan }),
    })
    setFrEditId(null); setFrEditThan('')
    mutatePacking()
  }

  const togglePackParty = (party: string) => {
    setPackExpandedParties(prev => {
      const next = new Set(prev)
      if (next.has(party)) next.delete(party); else next.add(party)
      return next
    })
  }
  const togglePackQuality = (key: string) => {
    setPackExpandedQualities(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const packingTotalThan = useMemo(() => packingEntries.reduce((s, e) => s + e.totalThan, 0), [packingEntries])

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Finish / Center</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {entries.length} slips &middot; {totalThan.toLocaleString()} than (done dyeing)
            </p>
          </div>
        </div>
        <Link href="/finish/new" className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 w-fit">
          + New Entry
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 dark:border-gray-700">
        {([['report', 'Stock Report'], ['slips', 'Finish_Prg'], ['packing', 'Folding Stock'], ['folding', 'Packing Stock'], ['register', 'Stock Register']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === key ? 'border-teal-600 text-teal-600 dark:text-teal-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ FINISH SLIP REGISTER TAB ═════════════════════════════════ */}
      {tab === 'slips' && (
        <>
          {/* Filters + Sort */}
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Finish_Prg No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={slipFilterSlip}
                  onChange={e => { setSlipFilterSlipRaw(e.target.value); setSlipDebouncedSlip(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Lot No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={slipFilterLot}
                  onChange={e => { setSlipFilterLotRaw(e.target.value); setSlipDebouncedLot(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Party</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={slipFilterParty}
                  onChange={e => { setSlipFilterPartyRaw(e.target.value); setSlipDebouncedParty(e.target.value) }} />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-gray-400 dark:text-gray-500">Sort:</span>
              {([['date', 'Date'], ['slipNo', 'Finish_Prg'], ['lotNo', 'Lot'], ['party', 'Party'], ['than', 'Than']] as [SlipSortField, string][]).map(([f, label]) => (
                <button key={f} onClick={() => toggleSlipSort(f)}
                  className={`text-xs px-2 py-1 rounded border ${slipSortField === f ? 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300 font-medium' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}>
                  {label} {slipSortField === f ? (slipSortDir === 'asc' ? '\u2191' : '\u2193') : ''}
                </button>
              ))}
              {(slipFilterSlip || slipFilterLot || slipFilterParty) && (
                <button onClick={() => {
                  setSlipFilterSlipRaw(''); setSlipDebouncedSlip('')
                  setSlipFilterLotRaw(''); setSlipDebouncedLot('')
                  setSlipFilterPartyRaw(''); setSlipDebouncedParty('')
                }} className="text-xs text-red-400 hover:text-red-600">Clear</button>
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{filteredSlips.length} of {slipEntries.length}</span>
            </div>
          </div>

          {slipsLoading ? <div className="p-12 text-center text-gray-400 dark:text-gray-500">Loading...</div> :
            filteredSlips.length === 0 ? (
              <div className="p-12 text-center text-gray-400 dark:text-gray-500">
                {slipEntries.length === 0 ? 'No finish entries found.' : 'No results found.'}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSlips.map(entry => {
                  const isEditing = editingSlipId === entry.id
                  const totalThanEntry = entry.lots.reduce((s, l) => s + l.than, 0)
                  const totalMeter = entry.lots.reduce((s, l) => s + (l.meter || 0), 0)

                  if (isEditing) {
                    return (
                      <div key={entry.id} className="bg-white dark:bg-gray-800 rounded-xl border-2 border-teal-300 dark:border-teal-700 shadow-lg overflow-hidden">
                        {/* FP Header */}
                        <div className="flex items-center justify-between px-4 py-3 bg-teal-50 dark:bg-teal-900/20 border-b border-teal-200 dark:border-teal-800">
                          <span className="text-sm font-bold text-teal-600 dark:text-teal-400">Edit Finish_Prg {entry.slipNo}</span>
                          <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
                        </div>
                        <div className="p-5 space-y-4">

                        {editError && (
                          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 text-sm">{editError}</div>
                        )}

                        {/* Date + Slip No */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
                            <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Finish_Prg No</label>
                            <input type="number" value={editSlipNo} onChange={e => setEditSlipNo(e.target.value)}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                          </div>
                        </div>

                        {/* Lots — grouped by Lot → Dye Slips */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                              Lots ({editLots.length} · {editLots.reduce((s, l) => s + (parseInt(l.than) || 0), 0)} than)
                            </label>
                          </div>
                          <div className="space-y-2">
                            {editLots.map((lot, li) => {
                              const lotThan = parseInt(lot.than) || 0
                              const enrichedLot = entry.lots[li]
                              const foldNo = enrichedLot?.foldNo || enrichedLot?.dyeSlips?.[0]?.foldNo || null
                              const hasSlipThans = lot.slipThans && lot.slipThans.length > 0
                              const slipSum = hasSlipThans ? lot.slipThans!.reduce((s, st) => s + (parseInt(st.than) || 0), 0) : 0
                              const totalEditThan = editLots.reduce((s, l) => s + (parseInt(l.than) || 0), 0)
                              const finMtr = parseFloat(editFinishMtr) || 0
                              const distributedMtr = totalEditThan > 0 && finMtr > 0 ? (lotThan / totalEditThan) * finMtr : 0
                              const expectedMtr = enrichedLot?.mtrPerThan ? enrichedLot.mtrPerThan * lotThan : 0
                              const mtrDiff = expectedMtr > 0 && distributedMtr > 0 ? ((distributedMtr - expectedMtr) / expectedMtr) * 100 : null
                              const mtrFlag = mtrDiff !== null ? (mtrDiff < -6 ? 'red' : mtrDiff < -4 ? 'orange' : 'green') : null

                              return (
                                <div key={li} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                  {/* Lot header */}
                                  <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {foldNo && <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">📁 {foldNo}</span>}
                                        <span className="text-xs font-bold text-teal-700 dark:text-teal-300">{lot.lotNo}</span>
                                        {enrichedLot?.quality && <span className="text-[10px] text-gray-500 dark:text-gray-400">{enrichedLot.quality}</span>}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {hasSlipThans ? (
                                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{slipSum}</span>
                                        ) : (
                                          <>
                                            <input type="number" value={lot.than}
                                              onChange={e => setEditLots(prev => { const u = [...prev]; u[li] = { ...u[li], than: e.target.value }; return u })}
                                              className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400 text-center font-medium" />
                                            <span className="text-[10px] text-gray-400">than</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    {/* Auto meter + shortage */}
                                    {lotThan > 0 && (
                                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        {distributedMtr > 0 && (
                                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{distributedMtr.toFixed(1)} mtr</span>
                                        )}
                                        {expectedMtr > 0 && (
                                          <span className="text-xs text-gray-500 dark:text-gray-400">({expectedMtr.toFixed(0)} exp)</span>
                                        )}
                                        {mtrFlag === 'red' && <span className="text-xs font-bold text-red-500">🔴 {mtrDiff?.toFixed(1)}%</span>}
                                        {mtrFlag === 'orange' && <span className="text-xs font-bold text-amber-500">🟠 {mtrDiff?.toFixed(1)}%</span>}
                                        {mtrFlag === 'green' && mtrDiff !== null && mtrDiff < -1 && <span className="text-xs font-medium text-green-500">{mtrDiff?.toFixed(1)}%</span>}
                                      </div>
                                    )}
                                  </div>

                                  {/* Per-slip than inputs */}
                                  {hasSlipThans && (
                                    <div className="px-3 py-1.5 space-y-1 border-t border-gray-100 dark:border-gray-700">
                                      {lot.slipThans!.map((st, si) => (
                                        <div key={si} className="flex items-center justify-between rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800">
                                          <div className="flex-1 min-w-0">
                                            <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                              Slip {st.slipNo}{st.shade ? ` — ${st.shade}` : ''}
                                            </p>
                                          </div>
                                          <div className="flex items-center gap-1.5 ml-2">
                                            <input type="number" value={st.than}
                                              onChange={e => {
                                                const newVal = e.target.value
                                                setEditLots(prev => {
                                                  const u = [...prev]
                                                  const newSlipThans = [...(u[li].slipThans || [])]
                                                  newSlipThans[si] = { ...newSlipThans[si], than: newVal }
                                                  const newTotal = newSlipThans.reduce((s, x) => s + (parseInt(x.than) || 0), 0)
                                                  u[li] = { ...u[li], slipThans: newSlipThans, than: String(newTotal) }
                                                  return u
                                                })
                                              }}
                                              className="w-14 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400 text-center font-medium" />
                                            <span className="text-[10px] text-gray-400">T</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>


                        {/* Add Lot from Stock */}
                        {showAddLot ? (
                          <div className="border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 bg-indigo-50/50 dark:bg-indigo-900/10">
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="text-xs font-bold text-indigo-700 dark:text-indigo-400">Add Lot from Dyeing Stock</h3>
                              <button onClick={() => setShowAddLot(false)} className="text-gray-400 text-sm">&times;</button>
                            </div>
                            <input type="text" placeholder="Search lot no..." value={addLotSearch} onChange={e => setAddLotSearch(e.target.value)}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 mb-2" />
                            <div className="max-h-40 overflow-y-auto space-y-1">
                              {entries.filter(e => {
                                if (!addLotSearch) return false
                                const q = addLotSearch.toLowerCase()
                                return e.lots.some(l => l.lotNo.toLowerCase().includes(q)) && !editLots.some(el => e.lots.some(l => l.lotNo === el.lotNo))
                              }).slice(0, 10).map(e => (
                                e.lots.filter(l => l.lotNo.toLowerCase().includes(addLotSearch.toLowerCase()) && !editLots.some(el => el.lotNo === l.lotNo)).map(l => (
                                  <button key={`${e.id}-${l.lotNo}`} onClick={() => {
                                    setEditLots(prev => [...prev, { lotNo: l.lotNo, than: String(l.than), meter: '' }])
                                    setShowAddLot(false)
                                    setAddLotSearch('')
                                  }}
                                    className="w-full text-left px-3 py-2 text-xs bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-400 flex items-center justify-between">
                                    <div>
                                      <span className="font-semibold text-teal-700 dark:text-teal-300">{l.lotNo}</span>
                                      <span className="text-gray-400 ml-2">Slip {e.slipNo}</span>
                                      {e.foldNo && <span className="text-indigo-500 ml-1">F{e.foldNo}</span>}
                                      {e.shadeName && <span className="text-purple-500 ml-1">{e.shadeName}</span>}
                                    </div>
                                    <span className="font-bold text-gray-700 dark:text-gray-200">{l.than}</span>
                                  </button>
                                ))
                              ))}
                              {addLotSearch && entries.filter(e => e.lots.some(l => l.lotNo.toLowerCase().includes(addLotSearch.toLowerCase()))).length === 0 && (
                                <p className="text-[10px] text-gray-400 text-center py-2">No matching lots in stock</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setShowAddLot(true)}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-medium">+ Add Lot from Stock</button>
                        )}

                        {/* Finish Completion */}
                        <div className="border border-teal-200 dark:border-teal-800 rounded-lg p-3 bg-teal-50/50 dark:bg-teal-900/10">
                          <h3 className="text-xs font-bold text-teal-700 dark:text-teal-400 mb-2">Finish Completion</h3>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Finish Than</label>
                              <input type="number" value={editFinishThan} onChange={e => setEditFinishThan(e.target.value)}
                                placeholder="0" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Finish Mtr</label>
                              <input type="number" step="0.1" value={editFinishMtr} onChange={e => setEditFinishMtr(e.target.value)}
                                placeholder="0" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Finish Desp Slip No</label>
                              <input type="text" value={editDespSlipNo} onChange={e => setEditDespSlipNo(e.target.value)}
                                placeholder="e.g. D-45" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                            </div>
                          </div>
                        </div>

                        {/* Chemicals */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Chemicals</label>
                              <button type="button" onClick={() => editLoadRecipe(entry)} disabled={editRecipeLoading}
                                className="text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 px-2.5 py-1 rounded-lg font-medium disabled:opacity-50 transition border border-indigo-200 dark:border-indigo-800">
                                {editRecipeLoading ? 'Loading...' : 'Load Recipe'}
                              </button>
                            </div>
                            <button type="button" onClick={addEditChemical}
                              className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium">
                              + Add Chemical
                            </button>
                          </div>
                          {editRecipeMsg && (
                            <p className={`text-xs mb-2 ${editRecipeMsg.includes('Loaded') ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>{editRecipeMsg}</p>
                          )}
                          {showEditRecipePicker && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowEditRecipePicker(false)}>
                              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                                  <div>
                                    <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Select Recipe</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{editRecipePickerParty} — {editRecipePickerList.length} recipe{editRecipePickerList.length !== 1 ? 's' : ''}</p>
                                  </div>
                                  <button onClick={() => setShowEditRecipePicker(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                  {editRecipePickerList.map(r => (
                                    <button key={r.id} onClick={() => applyEditRecipe(r)}
                                      className="w-full text-left bg-gray-50 dark:bg-gray-700/50 hover:bg-teal-50 dark:hover:bg-teal-900/20 border border-gray-200 dark:border-gray-600 hover:border-teal-300 dark:hover:border-teal-700 rounded-xl p-4 transition">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{r.quality.name}</span>
                                        <span className="text-xs text-gray-400 dark:text-gray-500">{r.items.length} chemical{r.items.length !== 1 ? 's' : ''}</span>
                                      </div>
                                      {r.variant && (
                                        <span className="inline-block text-[10px] bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded mb-1.5">{r.variant}</span>
                                      )}
                                      <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                                        {r.finishWidth && <span>FW: {r.finishWidth}</span>}
                                        {r.finalWidth && <span>Final: {r.finalWidth}</span>}
                                        {r.shortage && <span>Shortage: {r.shortage}</span>}
                                      </div>
                                      {r.items.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                          {r.items.slice(0, 6).map((item: any, i: number) => (
                                            <span key={i} className="inline-flex items-center gap-0.5 bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 text-[10px] px-1.5 py-0.5 rounded-full">
                                              {item.name} <span className="text-gray-400">({item.quantity}{item.unit})</span>
                                            </span>
                                          ))}
                                          {r.items.length > 6 && <span className="text-[10px] text-gray-400">+{r.items.length - 6}</span>}
                                        </div>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                          {editChemicals.length > 0 && (
                            <div className="space-y-2">
                              {editChemicals.map((chem, ci) => (
                                <div key={ci} className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                      <input type="text" placeholder="Chemical name" value={chem.name}
                                        onChange={e => updateEditChemical(ci, 'name', e.target.value)}
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400"
                                        list={`edit-chem-list-${ci}`} />
                                      <datalist id={`edit-chem-list-${ci}`}>
                                        {masterChemicals.map(m => (
                                          <option key={m.id} value={m.name} />
                                        ))}
                                      </datalist>
                                    </div>
                                    <button type="button" onClick={() => removeEditChemical(ci)}
                                      className="text-red-400 hover:text-red-600 text-lg leading-none shrink-0">&times;</button>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input type="number" step="0.01" placeholder="Qty" value={chem.quantity}
                                      onChange={e => updateEditChemical(ci, 'quantity', e.target.value)}
                                      className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                                    <select value={chem.unit} onChange={e => updateEditChemical(ci, 'unit', e.target.value)}
                                      className="w-14 border border-gray-300 dark:border-gray-600 rounded px-1 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400">
                                      <option value="kg">kg</option>
                                      <option value="ltr">ltr</option>
                                      <option value="gm">gm</option>
                                      <option value="ml">ml</option>
                                    </select>
                                    <input type="number" step="0.01" placeholder="Rate" value={chem.rate}
                                      onChange={e => updateEditChemical(ci, 'rate', e.target.value)}
                                      className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                                    {chem.cost != null && chem.cost > 0 && (
                                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">&#8377;{chem.cost.toFixed(0)}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Notes */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                          <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                            rows={2} placeholder="Optional notes..."
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
                        </div>

                        {/* ── Additions Section ── */}
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">Additions</h3>
                            <button type="button" onClick={() => {
                              // Pre-fill with chemicals from recipe
                              const chemTemplate = editChemicals.filter(c => c.name.trim()).map(c => ({
                                chemicalId: c.chemicalId,
                                name: c.name,
                                quantity: '',
                                unit: c.unit,
                              }))
                              setEditAdditions(prev => [...prev, { reason: '', chemicals: chemTemplate }])
                            }} className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 font-medium">
                              + Add Addition
                            </button>
                          </div>
                          {editAdditions.length > 0 && (
                            <div className="space-y-3">
                              {editAdditions.map((add, ai) => (
                                <div key={ai} className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-900/10">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-amber-700 dark:text-amber-400">Addition #{ai + 1}</span>
                                    <button type="button" onClick={() => setEditAdditions(prev => prev.filter((_, i) => i !== ai))}
                                      className="text-red-400 hover:text-red-600 text-sm">🗑️</button>
                                  </div>
                                  <input type="text" placeholder="Reason (optional)" value={add.reason}
                                    onChange={e => setEditAdditions(prev => { const u = [...prev]; u[ai] = { ...u[ai], reason: e.target.value }; return u })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400 mb-2" />
                                  <div className="space-y-1">
                                    {add.chemicals.map((c, ci) => (
                                      <div key={ci} className="flex items-center gap-2">
                                        <span className="text-xs text-gray-600 dark:text-gray-300 flex-1 truncate">{c.name}</span>
                                        <input type="number" step="0.01" placeholder="Qty" value={c.quantity}
                                          onChange={e => setEditAdditions(prev => {
                                            const u = [...prev]
                                            const chems = [...u[ai].chemicals]
                                            chems[ci] = { ...chems[ci], quantity: e.target.value }
                                            u[ai] = { ...u[ai], chemicals: chems }
                                            return u
                                          })}
                                          className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400 text-center" />
                                        <span className="text-[10px] text-gray-400 w-8">{c.unit}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* ── Consumption Section ── */}
                        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3">Chemical Mandi Consumption</h3>
                          <div className="grid grid-cols-3 gap-3 mb-3">
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Op Mandi (ltr)</label>
                              <input type="number" step="0.1" value={editOpMandi} onChange={e => setEditOpMandi(e.target.value)}
                                placeholder="0" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">New Mandi (ltr)</label>
                              <input type="number" step="0.1" value={editNewMandi} onChange={e => setEditNewMandi(e.target.value)}
                                placeholder="0" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Stock Mandi (ltr)</label>
                              <input type="number" step="0.1" value={editStockMandi} onChange={e => setEditStockMandi(e.target.value)}
                                placeholder="0" className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                            </div>
                          </div>

                          {/* Calculations */}
                          {(() => {
                            const op = parseFloat(editOpMandi) || 0
                            const nw = parseFloat(editNewMandi) || 0
                            const st = parseFloat(editStockMandi) || 0
                            const consumed = op + nw - st
                            const totalThanDone = entry.lots.reduce((s, l) => s + (l.status === 'done' ? l.than : l.status === 'partial' ? l.doneThan : 0), 0)
                            const totalThanAll = entry.lots.reduce((s, l) => s + l.than, 0)

                            // Sum addition quantities per chemical name
                            const additionQtyMap = new Map<string, number>()
                            for (const add of editAdditions) {
                              for (const c of add.chemicals) {
                                if (c.quantity) {
                                  const key = c.name.toLowerCase().trim()
                                  additionQtyMap.set(key, (additionQtyMap.get(key) || 0) + (parseFloat(c.quantity) || 0))
                                }
                              }
                            }

                            // Calculate cost from recipe (per 100 litres) + additions
                            const chemCosts = editChemicals.filter(c => c.name.trim()).map(c => {
                              const recipeQty = parseFloat(c.quantity) || 0
                              const rate = parseFloat(c.rate) || 0
                              const mandiUsed = consumed > 0 ? (recipeQty / 100) * consumed : 0
                              const addQty = additionQtyMap.get(c.name.toLowerCase().trim()) || 0
                              const usedQty = mandiUsed + addQty
                              const cost = usedQty * rate
                              return { name: c.name, recipeQty, rate, mandiUsed, addQty, usedQty, cost, unit: c.unit }
                            })
                            const totalCost = chemCosts.reduce((s, c) => s + c.cost, 0)
                            const costPerLtr = consumed > 0 ? totalCost / consumed : 0
                            const costPerThan = totalThanDone > 0 ? totalCost / totalThanDone : 0
                            const ltrPerThan = totalThanDone > 0 ? consumed / totalThanDone : totalThanAll > 0 ? consumed / totalThanAll : 0

                            if (consumed <= 0 && op === 0 && nw === 0) return null

                            return (
                              <div className="space-y-3">
                                {/* Consumed Mandi */}
                                <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-4 py-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Consumed Mandi</span>
                                    <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{consumed.toFixed(1)} ltr</span>
                                  </div>
                                  <p className="text-[10px] text-gray-400 mt-0.5">Op ({op}) + New ({nw}) - Stock ({st})</p>
                                </div>

                                {/* Chemical usage table */}
                                {chemCosts.length > 0 && consumed > 0 && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Chemical Usage ({consumed.toFixed(0)} ltr consumed)</p>
                                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                                            <th className="text-left px-2 py-1.5 font-semibold text-gray-600 dark:text-gray-300">Chemical</th>
                                            <th className="text-right px-2 py-1.5 font-semibold text-gray-600 dark:text-gray-300">Mandi</th>
                                            {editAdditions.length > 0 && <th className="text-right px-2 py-1.5 font-semibold text-amber-600 dark:text-amber-400">+Add</th>}
                                            <th className="text-right px-2 py-1.5 font-semibold text-gray-600 dark:text-gray-300">Total</th>
                                            <th className="text-right px-2 py-1.5 font-semibold text-gray-600 dark:text-gray-300">Cost</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                          {chemCosts.map((c, i) => (
                                            <tr key={i}>
                                              <td className="px-2 py-1.5 text-gray-700 dark:text-gray-200">{c.name}</td>
                                              <td className="px-2 py-1.5 text-right text-gray-500">{c.mandiUsed.toFixed(2)}</td>
                                              {editAdditions.length > 0 && <td className="px-2 py-1.5 text-right text-amber-600 dark:text-amber-400">{c.addQty > 0 ? `+${c.addQty.toFixed(2)}` : '-'}</td>}
                                              <td className="px-2 py-1.5 text-right font-medium text-gray-700 dark:text-gray-200">{c.usedQty.toFixed(2)} {c.unit}</td>
                                              <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">&#8377;{c.cost.toFixed(0)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}

                                {/* Cost summary */}
                                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3 space-y-1">
                                  {consumed > 0 && (
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-gray-600 dark:text-gray-300">Cost per Litre</span>
                                      <span className="text-xs font-medium text-gray-700 dark:text-gray-200">&#8377;{costPerLtr.toFixed(2)}/ltr</span>
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Total Cost{consumed > 0 ? ` (${consumed.toFixed(0)} ltr)` : ''}</span>
                                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">&#8377;{totalCost.toFixed(0)}</span>
                                  </div>
                                  {totalThanDone > 0 && (
                                    <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2 mt-2">
                                      <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">Cost per Than ({totalThanDone})</span>
                                      <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">&#8377;{costPerThan.toFixed(2)}/T</span>
                                    </div>
                                  )}
                                  {totalThanDone === 0 && totalThanAll > 0 && (
                                    <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 mt-2">
                                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Cost per Than ({totalThanAll})</span>
                                      <span className="text-base font-bold text-gray-600 dark:text-gray-300">&#8377;{(totalThanAll > 0 ? totalCost / totalThanAll : 0).toFixed(2)}/T</span>
                                    </div>
                                  )}
                                  {ltrPerThan > 0 && (
                                    <div className="flex items-center justify-between border-t border-emerald-200 dark:border-emerald-800 pt-1 mt-1">
                                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Consumption per Than</span>
                                      <span className="text-sm font-bold text-teal-600 dark:text-teal-400">{ltrPerThan.toFixed(2)} ltr/than</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })()}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3 pt-2">
                          <button onClick={handleEditSubmit} disabled={editSaving}
                            className="bg-teal-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-teal-700 disabled:opacity-50 transition">
                            {editSaving ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button onClick={cancelEdit} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                            Cancel
                          </button>
                        </div>
                        </div>
                      </div>
                    )
                  }

                  const fpOpen = expandedFPs.has(entry.id)
                  const statusBadge = entry.fpStatus === 'finished'
                    ? { label: 'Finished', cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800' }
                    : entry.fpStatus === 'partial'
                    ? { label: 'Partial', cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' }
                    : { label: 'Pending', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600' }

                  // Build party → fold → list-of-FP-lots-rendered-here directly
                  // from allocator output: each (slip, lot) tuple lands under its
                  // FP-lot's party AND the allocator's foldNo for that slip.
                  // This handles a single FP lot fed from multiple folds (common
                  // for RE-PRO lots that span 5–7 dyeing programs) — the old
                  // grouping pinned each lot to one foldNo and hid the rest.
                  const partyMap = new Map<string, Map<string, FinishLot[]>>()
                  const lotByName = new Map<string, FinishLot>()
                  for (const lot of entry.lots) lotByName.set(lot.lotNo, lot)
                  const seenInAllocator = new Set<string>() // `${lotNo}|${foldNo}`
                  for (const fg of (entry as any).allocations ?? []) {
                    for (const slip of fg.slips ?? []) {
                      for (const al of slip.lots ?? []) {
                        const fpLot = lotByName.get(al.lotNo)
                        if (!fpLot) continue
                        const p = fpLot.party || 'Unknown'
                        const f = fg.foldNo || 'No Fold'
                        if (!partyMap.has(p)) partyMap.set(p, new Map())
                        const fMap = partyMap.get(p)!
                        if (!fMap.has(f)) {
                          fMap.set(f, [])
                          // Push the fpLot once per (party,fold) cell so the inner
                          // lookup (lotById) finds it. Multiple slips inside the
                          // same fold all reference the same fpLot for status.
                          fMap.get(f)!.push(fpLot)
                          seenInAllocator.add(`${al.lotNo}|${f}`)
                        } else if (!seenInAllocator.has(`${al.lotNo}|${f}`)) {
                          fMap.get(f)!.push(fpLot)
                          seenInAllocator.add(`${al.lotNo}|${f}`)
                        }
                      }
                    }
                  }
                  // Orphan FP lots — no dyeing slip claimed them (e.g. came in
                  // via OB or startStage='finish'). Place them under their
                  // FP-recorded (party, foldNo) so they remain visible.
                  const allocLotNos = new Set<string>()
                  for (const fm of partyMap.values()) for (const arr of fm.values()) for (const l of arr) allocLotNos.add(l.lotNo)
                  for (const lot of entry.lots) {
                    if (allocLotNos.has(lot.lotNo)) continue
                    const p = lot.party || 'Unknown'
                    const f = lot.foldNo || 'No Fold'
                    if (!partyMap.has(p)) partyMap.set(p, new Map())
                    const fMap = partyMap.get(p)!
                    if (!fMap.has(f)) fMap.set(f, [])
                    fMap.get(f)!.push(lot)
                  }

                  return (
                    <div key={entry.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                      {/* FP Header — clickable to expand */}
                      {(() => {
                        const fpParties = [...new Set(entry.lots.map(l => l.party).filter(Boolean))]
                        const fpQualities = [...new Set(entry.lots.map(l => l.quality).filter(Boolean))]
                        const fpFolds = [...new Set(entry.lots.flatMap(l => l.dyeSlips?.map(ds => ds.foldNo) || [l.foldNo]).filter(Boolean))]
                        return (
                          <button onClick={() => toggleFP(entry.id)} className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-teal-600 dark:text-teal-400">Finish_Prg {entry.slipNo}</span>
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusBadge.cls}`}>{statusBadge.label}</span>
                                <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(entry.date).toLocaleDateString('en-IN')}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{totalThanEntry}</span>
                                <span className={`text-gray-400 dark:text-gray-500 transition-transform text-xs ${fpOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                              {fpParties.length > 0 && <span className="text-[10px] text-gray-600 dark:text-gray-300 font-medium">{fpParties.join(', ')}</span>}
                              {fpQualities.length > 0 && <span className="text-[10px] text-gray-500 dark:text-gray-400">· {fpQualities.join(', ')}</span>}
                              {fpFolds.length > 0 && <span className="text-[10px] text-indigo-500 dark:text-indigo-400">· F{fpFolds.join(', F')}</span>}
                            </div>
                            {entry.finishDespSlipNo && (
                              <div className="mt-1.5">
                                <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded">
                                  🚚 Slip {entry.finishDespSlipNo} · {new Date(entry.date).toLocaleDateString('en-IN')}
                                </span>
                              </div>
                            )}
                          </button>
                        )
                      })()}

                      {/* Expanded content */}
                      {fpOpen && (
                        <div className="border-t border-gray-100 dark:border-gray-700">
                          {/* Actions bar */}
                          <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700">
                            <Link href={`/finish/${entry.id}`}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium">View</Link>
                            <Link href={`/finish/${entry.id}/print`} target="_blank"
                              className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 font-medium">Print</Link>
                            <button onClick={() => startEdit(entry)}
                              className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 font-medium">Edit</button>
                            {role === 'admin' && (deleteConfirmId === entry.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
                                <button onClick={() => handleDelete(entry.id)} disabled={deleting}
                                  className="text-xs text-red-600 dark:text-red-400 font-bold disabled:opacity-50">{deleting ? '...' : 'Yes'}</button>
                                <button onClick={() => setDeleteConfirmId(null)}
                                  className="text-xs text-gray-400">No</button>
                              </div>
                            ) : (
                              <button onClick={() => setDeleteConfirmId(entry.id)}
                                className="text-xs text-red-400 hover:text-red-600 font-medium">Delete</button>
                            ))}
                            {entry.notes && <span className="text-[10px] text-gray-400 dark:text-gray-500 italic ml-auto">{entry.notes}</span>}
                          </div>

                          {/* Party → Fold → Slip → allocated lots — uses entry.allocations
                              from the slip allocator so a lot fed by multiple dyeing slips
                              shows as separate rows (e.g. PS-43/42 = 318/15 + 314/15 + 201/12)
                              instead of one slip with the FP-total than. */}
                          <div className="px-3 py-2 space-y-2">
                            {Array.from(partyMap.entries()).map(([partyName, foldMap]) => (
                              <div key={partyName}>
                                <div className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-1">👤 {partyName}</div>
                                {Array.from(foldMap.entries()).map(([foldNo, lots]) => (
                                  <div key={foldNo} className="ml-3 mb-2">
                                    <div className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mb-1">📁 Fold {foldNo}</div>
                                    {(() => {
                                      type Row = {
                                        slipNo: number; shade: string;
                                        lotNo: string; allocatedThan: number;
                                        lotId: number; status: string; doneThan: number;
                                      }
                                      const rows: Row[] = []
                                      const lotById = new Map(lots.map(l => [l.lotNo, l]))
                                      const allocatedHere = new Set<string>()
                                      const foldAlloc = (entry as any).allocations?.find((a: any) => a.foldNo === foldNo)
                                      if (foldAlloc) {
                                        for (const slip of foldAlloc.slips) {
                                          for (const al of slip.lots) {
                                            const fpLot = lotById.get(al.lotNo)
                                            if (!fpLot) continue   // belongs to a different (party,fold) cell
                                            rows.push({
                                              slipNo: slip.slipNo,
                                              shade: [slip.shadeName, slip.shadeDesc].filter(Boolean).join(' — '),
                                              lotNo: al.lotNo,
                                              allocatedThan: al.than,
                                              lotId: fpLot.id,
                                              status: fpLot.status,
                                              doneThan: fpLot.doneThan,
                                            })
                                            allocatedHere.add(al.lotNo)
                                          }
                                        }
                                      }
                                      // Lots in this (party,fold) that no dyeing slip claimed
                                      // (e.g. came in via OB or startStage='finish') still need
                                      // to render — under Slip 0 / no header.
                                      for (const lot of lots) {
                                        if (allocatedHere.has(lot.lotNo)) continue
                                        rows.push({
                                          slipNo: 0, shade: '',
                                          lotNo: lot.lotNo, allocatedThan: lot.than,
                                          lotId: lot.id, status: lot.status, doneThan: lot.doneThan,
                                        })
                                      }
                                      // Group rows back by slipNo for display
                                      const slipMap = new Map<number, Row[]>()
                                      for (const r of rows) {
                                        if (!slipMap.has(r.slipNo)) slipMap.set(r.slipNo, [])
                                        slipMap.get(r.slipNo)!.push(r)
                                      }
                                      const slipsSorted = Array.from(slipMap.entries()).sort((a, b) => b[0] - a[0])
                                      return slipsSorted.map(([slipNo, slipRows]) => {
                                        const shade = slipRows[0]?.shade || ''
                                        return (
                                          <div key={slipNo} className="ml-3 mb-1.5">
                                            {slipNo > 0 && (
                                              <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
                                                Slip {slipNo}{shade ? ` — ${shade}` : ''}
                                              </div>
                                            )}
                                            <div className="space-y-1">
                                              {slipRows.map((row, i) => (
                                                <div key={`${slipNo}-${row.lotNo}-${i}`} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2">
                                                  <Link href={`/lot/${encodeURIComponent(row.lotNo)}`}
                                                    className="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline">{row.lotNo}</Link>
                                                  <span className="text-xs text-gray-600 dark:text-gray-400">{row.allocatedThan}</span>

                                                  {/* Status + actions — keyed on the FP lot id (lot status is FP-level not slip-level).
                                                      Pill count shows THIS row's allocated than, not the FP-level doneThan
                                                      (otherwise a 3-slip lot showed "Done (42)" on every row). */}
                                                  {row.status === 'done' ? (
                                                    <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium ml-auto">✅ Done ({row.allocatedThan})</span>
                                                  ) : row.status === 'partial' ? (
                                                    <div className="flex items-center gap-1.5 ml-auto">
                                                      <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">🟡 {row.doneThan} done</span>
                                                      {partialLotId === row.lotId ? (
                                                        <div className="flex items-center gap-1">
                                                          <input type="number" value={partialThanInput} onChange={e => setPartialThanInput(e.target.value)}
                                                            placeholder="than" className="w-14 text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100" />
                                                          <button onClick={() => updateLotStatus(row.lotId, 'partial', parseInt(partialThanInput))}
                                                            disabled={lotUpdating === row.lotId} className="text-[10px] text-teal-600 font-bold">Save</button>
                                                          <button onClick={() => setPartialLotId(null)} className="text-[10px] text-gray-400">✕</button>
                                                        </div>
                                                      ) : (
                                                        <button onClick={() => { setPartialLotId(row.lotId); setPartialThanInput(String(row.doneThan)) }}
                                                          className="text-[10px] text-indigo-500 hover:text-indigo-400 underline">Edit</button>
                                                      )}
                                                      <button onClick={() => updateLotStatus(row.lotId, 'done')}
                                                        disabled={lotUpdating === row.lotId} className="text-[10px] text-green-600 font-medium">Full Done</button>
                                                    </div>
                                                  ) : (
                                                    <div className="flex items-center gap-1.5 ml-auto">
                                                      <button onClick={() => updateLotStatus(row.lotId, 'done')}
                                                        disabled={lotUpdating === row.lotId}
                                                        className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded font-medium hover:bg-green-700 disabled:opacity-50">
                                                        {lotUpdating === row.lotId ? '...' : '✅ Done'}
                                                      </button>
                                                      <button onClick={() => { setPartialLotId(row.lotId); setPartialThanInput('') }}
                                                        className="text-[10px] bg-amber-600 text-white px-2 py-0.5 rounded font-medium hover:bg-amber-700">
                                                        🟡 Partial
                                                      </button>
                                                    </div>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )
                                      })
                                    })()}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>

                          {/* Partial than input popup */}
                          {partialLotId && entry.lots.some(l => l.id === partialLotId && l.status === 'pending') && (
                            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Done than:</span>
                                <input type="number" value={partialThanInput} onChange={e => setPartialThanInput(e.target.value)}
                                  placeholder="Enter done than"
                                  className="w-20 text-sm border border-amber-300 dark:border-amber-700 rounded px-2 py-1 bg-white dark:bg-gray-800 dark:text-gray-100" />
                                <button onClick={() => updateLotStatus(partialLotId, 'partial', parseInt(partialThanInput))}
                                  disabled={lotUpdating === partialLotId || !partialThanInput}
                                  className="text-xs bg-amber-600 text-white px-3 py-1 rounded font-medium hover:bg-amber-700 disabled:opacity-50">
                                  {lotUpdating === partialLotId ? '...' : 'Save'}
                                </button>
                                <button onClick={() => { setPartialLotId(null); setPartialThanInput('') }}
                                  className="text-xs text-gray-400 hover:text-gray-200">Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Footer summary */}
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                    Total ({filteredSlips.length} slips)
                  </span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    {filteredSlips.reduce((s, e) => s + e.lots.reduce((s2, l) => s2 + l.than, 0), 0)} than
                  </span>
                </div>
              </div>
            )}

        </>
      )}

      {/* ═══ FOLDING STOCK TAB ═══════════════════════════════════════ */}
      {tab === 'folding' && (
        <div>
          {packingLoading ? <div className="p-12 text-center text-gray-400">Loading...</div> : (
            <div className="space-y-3">
              {/* View toggle */}
              <div className="flex gap-2 mb-3">
                <button onClick={() => setPackView('desp')}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${packView === 'desp' ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}>
                  Rec Slip-wise
                </button>
                <button onClick={() => setPackView('party')}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${packView === 'party' ? 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'}`}>
                  Party → Quality → Desp → Lot
                </button>
              </div>

              {/* Rec Slip-wise view */}
              {packView === 'desp' && (() => {
                const allReceipts: any[] = []
                for (const pe of packingEntries) {
                  for (const l of pe.lots) {
                    for (const r of (l.foldingReceipts || [])) {
                      allReceipts.push({ ...r, lotNo: l.lotNo, lotThan: l.than, fpSlipNo: pe.slipNo, despSlipNo: pe.finishDespSlipNo })
                    }
                  }
                }
                const slipMap = new Map<string, any[]>()
                for (const r of allReceipts) {
                  if (!slipMap.has(r.slipNo)) slipMap.set(r.slipNo, [])
                  slipMap.get(r.slipNo)!.push(r)
                }

                async function handleEditFR(r: any) {
                  const newThan = prompt(`Edit Folding_recpt ${r.slipNo} — ${r.lotNo}\nCurrent: ${r.than}\n\nNew than:`, String(r.than))
                  if (newThan === null || newThan === String(r.than)) return
                  const newDate = prompt('Date (YYYY-MM-DD):', new Date(r.date).toISOString().split('T')[0])
                  if (newDate === null) return
                  try {
                    await fetch('/api/finish/folding-receipt', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: r.id, than: parseInt(newThan), date: newDate }),
                    })
                    mutatePacking()
                  } catch {}
                }

                async function handleDeleteFR(r: any) {
                  if (!confirm(`Delete Folding_recpt ${r.slipNo} — ${r.lotNo} (${r.than})?`)) return
                  try {
                    await fetch('/api/finish/folding-receipt', {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: r.id }),
                    })
                    mutatePacking()
                  } catch {}
                }

                // Filter by search
                const q = frSearch.toLowerCase().trim()
                const filteredReceipts = q
                  ? allReceipts.filter(r =>
                      r.slipNo.toLowerCase().includes(q) ||
                      r.lotNo.toLowerCase().includes(q) ||
                      String(r.fpSlipNo).includes(q) ||
                      (r.despSlipNo || '').toLowerCase().includes(q)
                    )
                  : allReceipts

                // Rebuild slipMap from filtered
                const filteredSlipMap = new Map<string, any[]>()
                for (const r of filteredReceipts) {
                  if (!filteredSlipMap.has(r.slipNo)) filteredSlipMap.set(r.slipNo, [])
                  filteredSlipMap.get(r.slipNo)!.push(r)
                }

                // Sort slip entries
                const sortedSlips = Array.from(filteredSlipMap.entries()).sort((a, b) => {
                  const na = parseInt(a[0]) || 0, nb = parseInt(b[0]) || 0
                  return frSortDir === 'asc' ? na - nb : nb - na
                })

                return (
                  <div className="space-y-2">
                    {/* Search + Sort bar */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        value={frSearch}
                        onChange={e => setFrSearch(e.target.value)}
                        placeholder="🔍 Folding_recpt slip, lot, Finish_Prg no..."
                        className="flex-1 min-w-[150px] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
                      />
                      <button
                        onClick={() => setFrSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 font-medium"
                      >
                        FR# {frSortDir === 'asc' ? '↑' : '↓'}
                      </button>
                      {frSearch && (
                        <button onClick={() => setFrSearch('')} className="text-xs text-red-400 hover:text-red-600">Clear</button>
                      )}
                      <span className="text-[10px] text-gray-400 ml-auto">{filteredReceipts.length} of {allReceipts.length}</span>
                    </div>

                    {filteredReceipts.length === 0 && (
                      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">
                        {allReceipts.length === 0 ? 'No folding receipts yet.' : `No results for "${frSearch}"`}
                      </div>
                    )}
                    {sortedSlips.map(([slipNo, recs]) => {
                      const totalThan = recs.reduce((s: number, r: any) => s + r.than, 0)
                      return (
                        <div key={slipNo} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">Folding_recpt {slipNo}</span>
                            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{totalThan}</span>
                          </div>
                          <div className="space-y-1">
                            {recs.map((r: any, i: number) => (
                              <div key={i} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-1.5">
                                <div>
                                  <span className="font-medium text-gray-700 dark:text-gray-200">{r.lotNo}</span>
                                  <span className="text-gray-400 ml-2">Finish_Prg {r.fpSlipNo}</span>
                                  {r.despSlipNo && <span className="text-purple-500 ml-1">Desp: {r.despSlipNo}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400">{new Date(r.date).toLocaleDateString('en-IN')}</span>
                                  <span className="font-bold text-gray-700 dark:text-gray-200">{r.than}</span>
                                  <button onClick={() => handleEditFR(r)} className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-[10px] font-medium">Edit</button>
                                  <button onClick={() => handleDeleteFR(r)} className="text-red-400 hover:text-red-600 dark:hover:text-red-300 text-[10px] font-medium">Del</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Party → Quality → Desp → Lot (4-level, fold removed, completed lots hidden) */}
              {packView === 'party' && (() => {
                // Build 4-level hierarchy. Skip lots that have already been
                // fully received in folding (or despatched) — the user only
                // cares about what's still pending in this view.
                const partyMap = new Map<string, Map<string, Map<string, any[]>>>()

                for (const pe of packingEntries) {
                  for (const l of pe.lots) {
                    const recs = (l as any).foldingReceipts || []
                    const received = recs.reduce((s: number, r: any) => s + r.than, 0)
                    const despatched = (l as any).despatchedThan || 0
                    if (received + despatched >= l.than) continue // hide completed

                    const party = (l as any).party || 'Unknown'
                    const quality = (l as any).quality || 'Unknown'
                    const desp = pe.finishDespSlipNo || 'No Desp'

                    if (!partyMap.has(party)) partyMap.set(party, new Map())
                    const qMap = partyMap.get(party)!
                    if (!qMap.has(quality)) qMap.set(quality, new Map())
                    const dMap = qMap.get(quality)!
                    if (!dMap.has(desp)) dMap.set(desp, [])
                    dMap.get(desp)!.push({ ...l, fpSlipNo: pe.slipNo, _received: received, _despatched: despatched })
                  }
                }

                if (partyMap.size === 0) {
                  return <div className="p-12 text-center text-gray-400 dark:text-gray-500">No pending lots — everything received in folding.</div>
                }

                return (
                  <div className="space-y-2">
                    {Array.from(partyMap.entries()).map(([party, qMap]) => (
                      <div key={party} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                        <button onClick={() => togglePackParty(party)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">👤 {party}</span>
                          <span className={`text-gray-400 text-xs ${packExpandedParties.has(party) ? 'rotate-90' : ''}`}>▶</span>
                        </button>
                        {packExpandedParties.has(party) && (
                          <div className="border-t border-gray-100 dark:border-gray-700 px-3 pb-3 pt-1 space-y-1.5">
                            {Array.from(qMap.entries()).map(([quality, dMap]) => {
                              const qKey = `${party}::${quality}`
                              const dKeysForQuality = Array.from(dMap.keys()).map(desp => `${qKey}::${desp}`)
                              return (
                                <div key={qKey} className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                                  <button onClick={() => {
                                      const isOpening = !packExpandedQualities.has(qKey)
                                      setPackExpandedQualities(prev => { const n = new Set(prev); if (n.has(qKey)) n.delete(qKey); else n.add(qKey); return n })
                                      // Auto-expand every desp under this quality when opening
                                      if (isOpening) {
                                        setExpandedDesp(prev => { const n = new Set(prev); for (const k of dKeysForQuality) n.add(k); return n })
                                      }
                                    }}
                                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">🏷️ {quality}{(() => { const rv = recipeVariantMap.get(`${party.toLowerCase().trim()}::${quality.toLowerCase().trim()}`); return rv ? ` (${rv})` : '' })()}</span>
                                    <span className={`text-gray-400 text-[10px] ${packExpandedQualities.has(qKey) ? 'rotate-90' : ''}`}>▶</span>
                                  </button>
                                  {packExpandedQualities.has(qKey) && (
                                    <div className="border-t border-gray-50 dark:border-gray-700 px-2 pb-2 pt-1 space-y-1">
                                      {Array.from(dMap.entries()).map(([desp, lots]) => {
                                        const dKey = `${qKey}::${desp}`
                                        return (
                                          <div key={dKey} className="border border-gray-100 dark:border-gray-600 rounded-lg overflow-hidden">
                                            <button onClick={() => { setExpandedDesp(prev => { const n = new Set(prev); if (n.has(dKey)) n.delete(dKey); else n.add(dKey); return n }) }}
                                              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                                              <span className={`text-[11px] font-bold ${desp !== 'No Desp' ? 'text-purple-600 dark:text-purple-400' : 'text-gray-400'}`}>📋 {desp}</span>
                                              <span className={`text-gray-400 text-[10px] ${expandedDesp.has(dKey) ? 'rotate-90' : ''}`}>▶</span>
                                            </button>
                                            {expandedDesp.has(dKey) && (
                                              <div className="border-t border-gray-50 dark:border-gray-700 px-2 pb-1 pt-1 space-y-1">
                                                {lots.map((lot: any, li: number) => {
                                                  const recs = lot.foldingReceipts || []
                                                  const received = lot._received as number
                                                  const balance = lot.than - received - (lot._despatched as number)
                                                  return (
                                                    <div key={li} data-lot-card={lot.lotNo} className="rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50">
                                                      <div className="flex items-center justify-between mb-1">
                                                        <LotLink lotNo={lot.lotNo} storageKey={FINISH_VIEW_KEY}
                                                          className="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline">
                                                          {lot.lotNo}
                                                        </LotLink>
                                                        <span className="text-xs">{received}/{lot.than} ⏳ <span className="font-bold text-emerald-600 dark:text-emerald-400">·{balance}</span></span>
                                                      </div>
                                                      {recs.length > 0 && (
                                                        <div className="space-y-0.5">
                                                          {recs.map((r: any) => (
                                                            <div key={r.id} className="flex items-center justify-between text-[10px] text-gray-500">
                                                              <span>Folding_recpt {r.slipNo} · {new Date(r.date).toLocaleDateString('en-IN')}</span>
                                                              <span className="font-medium">{r.than}</span>
                                                            </div>
                                                          ))}
                                                        </div>
                                                      )}
                                                    </div>
                                                  )
                                                })}
                                              </div>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {/* ═══ STOCK REGISTER TAB ═══════════════════════════════════════ */}
      {tab === 'register' && (
        <>
          {/* Filters + Sort */}
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Finish_Prg No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterSlip}
                  onChange={e => { setFilterSlipRaw(e.target.value); setDebouncedSlip(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Lot No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterLot}
                  onChange={e => { setFilterLotRaw(e.target.value); setDebouncedLot(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Party</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterParty}
                  onChange={e => { setFilterPartyRaw(e.target.value); setDebouncedParty(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Quality</label>
                <select
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterQuality}
                  onChange={e => { setFilterQualityRaw(e.target.value); setDebouncedQuality(e.target.value) }}>
                  <option value="">All</option>
                  {qualityOptions.map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-gray-400 dark:text-gray-500">Sort:</span>
              {([['date', 'Date'], ['slipNo', 'Slip'], ['lotNo', 'Lot'], ['party', 'Party'], ['quality', 'Quality'], ['than', 'Than']] as [SortField, string][]).map(([f, label]) => (
                <button key={f} onClick={() => toggleSort(f)}
                  className={`text-xs px-2 py-1 rounded border ${sortField === f ? 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300 font-medium' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}>
                  {label} {sortField === f ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
                </button>
              ))}
              {(filterSlip || filterLot || filterParty || filterQuality) && (
                <button onClick={() => {
                  setFilterSlipRaw(''); setDebouncedSlip('')
                  setFilterLotRaw(''); setDebouncedLot('')
                  setFilterPartyRaw(''); setDebouncedParty('')
                  setFilterQualityRaw(''); setDebouncedQuality('')
                }} className="text-xs text-red-400 hover:text-red-600">Clear</button>
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{filtered.length} of {entries.length}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {loading ? <div className="p-12 text-center text-gray-400 dark:text-gray-500">Loading...</div> :
              filtered.length === 0 ? (
                <div className="p-12 text-center text-gray-400 dark:text-gray-500">
                  {entries.length === 0 ? 'No done dyeing slips found.' : 'No results found.'}
                </div>
              ) : (
                <>
                  {/* Mobile card view */}
                  <div className="block sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                    {filtered.map(e => {
                      const shade = shadeDisplay(e.shadeName, e.shadeDescription)
                      const parties = [...new Set(e.lots.map(l => l.party).filter(Boolean))].join(', ')
                      const qualities = [...new Set(e.lots.map(l => l.quality).filter(Boolean))].join(', ')
                      return (
                        <div key={e.id} className="p-4">
                          <div className="flex items-start justify-between mb-1.5">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                              <span>{new Date(e.date).toLocaleDateString('en-IN')}</span>
                              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                              <span className="text-teal-600 dark:text-teal-400 font-medium">Finish_Prg {e.slipNo}</span>
                            </div>
                            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{e.totalThan}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            {e.lots.map((lot, li) => (
                              <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                className="inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/30">
                                {lot.lotNo} <span className="text-teal-400 dark:text-teal-500 font-normal">({lot.than})</span>
                              </Link>
                            ))}
                          </div>
                          {shade && <p className="text-xs text-gray-600 dark:text-gray-300 mb-0.5">{shade}</p>}
                          {parties && <p className="text-[10px] text-gray-500 dark:text-gray-400">{parties}</p>}
                          {qualities && <p className="text-[10px] text-gray-400 dark:text-gray-500">{qualities}</p>}
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                            {e.machineName && <span>{e.machineName}</span>}
                            {e.operatorName && <span>{e.operatorName}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
                        <tr>
                          <ThSort field="date" label="Date" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <ThSort field="slipNo" label="Finish_Prg" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <ThSort field="lotNo" label="Lot No (Than)" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Shade</th>
                          <ThSort field="party" label="Party" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <ThSort field="quality" label="Quality" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <ThSort field="than" label="Than" active={sortField} dir={sortDir} toggle={toggleSort} right />
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Machine</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Operator</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                        {filtered.map(e => {
                          const shade = shadeDisplay(e.shadeName, e.shadeDescription)
                          const parties = [...new Set(e.lots.map(l => l.party).filter(Boolean))].join(', ')
                          const qualities = [...new Set(e.lots.map(l => l.quality).filter(Boolean))].join(', ')
                          return (
                            <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                              <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                              <td className="px-3 py-2.5 font-medium text-teal-600 dark:text-teal-400">{e.slipNo}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {e.lots.map((lot, li) => (
                                    <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                      className="inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 text-xs font-semibold px-2 py-0.5 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/30">
                                      {lot.lotNo} <span className="text-teal-400 dark:text-teal-500 font-normal">({lot.than})</span>
                                    </Link>
                                  ))}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{shade ?? '\u2014'}</td>
                              <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300">{parties || '\u2014'}</td>
                              <td className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300">{qualities || '\u2014'}</td>
                              <td className="px-3 py-2.5 text-right font-semibold">{e.totalThan}</td>
                              <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">{e.machineName ?? '\u2014'}</td>
                              <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">{e.operatorName ?? '\u2014'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 dark:bg-gray-700/50 border-t-2 border-gray-200 dark:border-gray-700">
                        <tr>
                          <td colSpan={6} className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Total ({filtered.length} slips)</td>
                          <td className="px-3 py-3 text-right font-bold text-emerald-700 dark:text-emerald-400">{filtered.reduce((s, e) => s + e.totalThan, 0)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
          </div>
        </>
      )}

      {/* ═══ STOCK REPORT TAB ═════════════════════════════════════════ */}
      {tab === 'report' && (
        <div>
          {loading ? <div className="p-12 text-center text-gray-400 dark:text-gray-500">Loading...</div> :
            partyGroups.length === 0 ? <div className="p-12 text-center text-gray-400 dark:text-gray-500">No done dyeing slips found.</div> : (
              <div className="space-y-3">
                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Parties</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">{partyGroups.length}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Slips</p>
                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400 mt-1">{entries.length}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Than</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{totalThan.toLocaleString()}</p>
                  </div>
                </div>

                {/* Select All checkbox */}
                <div className="flex items-center gap-3 px-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allReportLots.length > 0 && selectedLots.size === allReportLots.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500 dark:bg-gray-700"
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">Select All</span>
                  </label>
                  {selectedLots.size > 0 && (
                    <span className="text-xs text-teal-600 dark:text-teal-400">
                      {selectedLots.size} lot{selectedLots.size !== 1 ? 's' : ''} selected ({selectedThan} than)
                    </span>
                  )}
                </div>

                {/* Search box */}
                <div className="relative">
                  <input
                    type="text"
                    value={reportSearch}
                    onChange={e => setReportSearch(e.target.value)}
                    placeholder="🔍 Search party, quality, or lot no..."
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  {reportSearch && (
                    <button
                      onClick={() => setReportSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
                    >&times;</button>
                  )}
                </div>

                {/* Party cards */}
                {filteredPartyGroups.length === 0 && reportSearch && (
                  <div className="p-8 text-center text-gray-400 dark:text-gray-500">No results for &ldquo;{reportSearch}&rdquo;</div>
                )}
                {filteredPartyGroups.map(pg => {
                  const isOpen = expandedParties.has(pg.party)
                  const partyLots = allReportLots.filter(l => l.party === pg.party)
                  const partyAllSelected = partyLots.length > 0 && partyLots.every(l => selectedLots.has(lotKey(l)))
                  const partySomeSelected = partyLots.some(l => selectedLots.has(lotKey(l)))
                  return (
                    <div key={pg.party} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                      {/* Level 1: Party header */}
                      <div className="flex items-center">
                        <label className="flex items-center pl-4 cursor-pointer" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={partyAllSelected}
                            ref={el => { if (el) el.indeterminate = partySomeSelected && !partyAllSelected }}
                            onChange={() => togglePartySelection(pg.party)}
                            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500 dark:bg-gray-700"
                          />
                        </label>
                        <button
                          onClick={() => toggleParty(pg.party)}
                          className="flex-1 flex items-center justify-between px-3 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                        >
                          <div className="text-left">
                            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{pg.party}</h3>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                              {pg.totalSlips} slip{pg.totalSlips !== 1 ? 's' : ''} &middot; {pg.totalLots} lot{pg.totalLots !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{pg.totalThan} than</span>
                            <span className={`text-gray-400 dark:text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                          </div>
                        </button>
                      </div>

                      {/* Level 2: Quality cards inside party */}
                      {isOpen && (
                        <div className="border-t border-gray-100 dark:border-gray-700 px-3 pb-3 space-y-2 pt-2">
                          {pg.qualities.map(qg => {
                            const qKey = `${pg.party}::${qg.quality}`
                            const qOpen = expandedQualities.has(qKey)
                            return (
                              <div key={qKey} className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => toggleQuality(qKey)}
                                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                                >
                                  <div className="text-left">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                                      {qg.quality}
                                      {(() => {
                                        const rv = recipeVariantMap.get(`${pg.party.toLowerCase().trim()}::${qg.quality.toLowerCase().trim()}`)
                                        return rv ? <span className="ml-1.5 text-[10px] font-normal text-teal-600 dark:text-teal-400">({rv})</span> : null
                                      })()}
                                    </h4>
                                    {qg.weight && <p className="text-[10px] text-gray-400 dark:text-gray-500">Weight: {qg.weight}</p>}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{qg.totalThan} than</span>
                                    <span className={`text-gray-400 dark:text-gray-500 text-xs transition-transform ${qOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                                  </div>
                                </button>

                                {/* Level 3: Fold groups inside quality */}
                                {qOpen && (
                                  <div className="border-t border-gray-50 dark:border-gray-700 px-2 pb-2 pt-1 space-y-1.5">
                                    {qg.folds.map(fg => {
                                      const fKey = `${pg.party}::${qg.quality}::${fg.foldNo}`
                                      const fOpen = expandedFolds.has(fKey)
                                      return (
                                        <div key={fKey} className="border border-gray-100 dark:border-gray-600 rounded-lg overflow-hidden">
                                          <button
                                            onClick={() => toggleFold(fKey)}
                                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                                          >
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">Fold {fg.foldNo}</span>
                                                <span className="text-[10px] text-gray-400 dark:text-gray-500">{fg.slips.length} slip{fg.slips.length !== 1 ? 's' : ''}</span>
                                              </div>
                                              <div className="flex items-center gap-3">
                                                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{fg.totalThan} than</span>
                                                <span className={`text-gray-400 dark:text-gray-500 text-[10px] transition-transform ${fOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                                              </div>
                                            </div>
                                            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                                              {pg.party} · {qg.quality}
                                            </p>
                                          </button>

                                          {/* Level 4: Slip details inside fold */}
                                          {fOpen && (
                                            <div className="border-t border-gray-50 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
                                              {fg.slips.map(slip => {
                                                const shade = shadeDisplay(slip.shadeName, slip.shadeDescription)
                                                const qLots = slip.lots.filter(l => (l.quality ?? 'Unknown') === qg.quality && (l.party ?? 'Unknown') === pg.party)
                                                const slipQualityThan = qLots.reduce((s, l) => s + l.than, 0)
                                                return (
                                                  <div key={slip.id} className="px-3 py-2.5">
                                                    <div className="flex items-center justify-between mb-1">
                                                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                        <span className="font-medium text-teal-600 dark:text-teal-400">Slip {slip.slipNo}</span>
                                                        <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                                                        <span>{new Date(slip.date).toLocaleDateString('en-IN')}</span>
                                                        {slip.batchNo && <span className="text-[10px] text-gray-400">B{slip.batchNo}</span>}
                                                      </div>
                                                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{slipQualityThan}</span>
                                                    </div>
                                                    {shade && <p className="text-xs text-gray-600 dark:text-gray-300 mb-0.5">{shade}</p>}
                                                    <div className="flex flex-wrap gap-1.5">
                                                      {qLots.map((lot, li) => {
                                                        const lotData: SelectedLot = {
                                                          lotNo: lot.lotNo,
                                                          than: lot.than,
                                                          party: pg.party,
                                                          quality: qg.quality,
                                                          shade: shade ?? '',
                                                          slipNo: slip.slipNo,
                                                        }
                                                        const isSelected = selectedLots.has(lotKey(lotData))
                                                        return (
                                                          <label key={li} className="inline-flex items-center gap-1 cursor-pointer">
                                                            <input
                                                              type="checkbox"
                                                              checked={isSelected}
                                                              onChange={() => toggleLotSelection(lotData)}
                                                              className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500 dark:bg-gray-700"
                                                            />
                                                            {selectedLots.size > 0 ? (
                                                              <span className={`inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full ${isSelected ? 'bg-teal-200 dark:bg-teal-800/40 text-teal-800 dark:text-teal-200 font-bold' : 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'}`}>
                                                                {lot.lotNo}<span className="text-teal-400 dark:text-teal-500">({lot.than})</span>
                                                              </span>
                                                            ) : (
                                                              <Link href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                                                onClick={e => e.stopPropagation()}
                                                                className={`inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/30 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300`}>
                                                                {lot.lotNo}<span className="text-teal-400 dark:text-teal-500">({lot.than})</span>
                                                              </Link>
                                                            )}
                                                          </label>
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
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* ── Sticky bottom bar when lots selected ──────────────── */}
                {selectedLots.size > 0 && !showFinishForm && (
                  <div className="sticky bottom-0 z-30 bg-teal-600 dark:bg-teal-700 text-white rounded-xl shadow-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">
                        {selectedLots.size} lot{selectedLots.size !== 1 ? 's' : ''} selected ({selectedThan} than)
                      </p>
                      <p className="text-xs text-teal-200 dark:text-teal-300 mt-0.5">
                        {[...new Set(Array.from(selectedLots.values()).map(l => l.party))].join(', ')}
                      </p>
                    </div>
                    <button
                      onClick={startFinish}
                      className="bg-white text-teal-700 px-5 py-2 rounded-lg text-sm font-bold hover:bg-teal-50 transition"
                    >
                      Start Finish for {selectedLots.size} lots &rarr;
                    </button>
                  </div>
                )}

                {/* ── Inline Finish Form ────────────────────────────────── */}
                {showFinishForm && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-teal-300 dark:border-teal-700 shadow-lg p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">New Finish Entry</h2>
                      <button onClick={cancelFinish} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
                    </div>

                    {finishError && (
                      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 text-sm">{finishError}</div>
                    )}

                    {/* Date + Slip No */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
                        <input type="date" value={finishDate} onChange={e => setFinishDate(e.target.value)}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Finish_Prg No</label>
                        <input type="number" value={finishSlipNo} onChange={e => setFinishSlipNo(e.target.value)}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                      </div>
                    </div>

                    {/* Selected lots grouped by lotNo */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                        Lots ({selectedLots.size} entries · {(() => {
                          const lotNos = new Set(Array.from(selectedLots.values()).map(l => l.lotNo))
                          return lotNos.size
                        })()} unique lots)
                      </label>
                      <div className="space-y-2">
                        {(() => {
                          // Group by lotNo
                          const grouped = new Map<string, SelectedLot[]>()
                          for (const lot of selectedLots.values()) {
                            if (!grouped.has(lot.lotNo)) grouped.set(lot.lotNo, [])
                            grouped.get(lot.lotNo)!.push(lot)
                          }
                          return Array.from(grouped.entries()).map(([lotNo, slips]) => {
                            const totalThan = slips.reduce((s, l) => {
                              const ok = `${l.slipNo}::${l.lotNo}`
                              return s + (finishThanOverrides[ok] ? parseInt(finishThanOverrides[ok]) || 0 : l.than)
                            }, 0)
                            return (
                              <div key={lotNo} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                {/* Lot header */}
                                <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 flex items-center justify-between">
                                  <span className="font-bold text-teal-700 dark:text-teal-300 text-sm">{lotNo}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Total: <strong className="text-gray-800 dark:text-gray-200">{totalThan} than</strong></span>
                                    {(() => {
                                      const firstSlot = slips[0]
                                      // Find mtrPerThan from entries
                                      let mpt: number | null = null
                                      for (const e of entries) {
                                        const l = e.lots.find((l: any) => l.lotNo === lotNo)
                                        if (l?.mtrPerThan) { mpt = l.mtrPerThan; break }
                                      }
                                      const expected = mpt ? mpt * totalThan : 0
                                      const actual = parseFloat(finishMeters[lotNo] || '0')
                                      const diff = expected > 0 && actual > 0 ? ((actual - expected) / expected) * 100 : null
                                      const flag = diff !== null ? (diff < -6 ? 'red' : diff < -4 ? 'orange' : diff < -1 ? 'green' : 'green') : null
                                      return (
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="number" step="0.1" placeholder="Meter"
                                            value={finishMeters[lotNo] ?? ''}
                                            onChange={e => setFinishMeters(prev => ({ ...prev, [lotNo]: e.target.value }))}
                                            className={`w-20 border rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400 ${flag === 'red' ? 'border-red-500' : flag === 'orange' ? 'border-amber-500' : 'border-gray-300 dark:border-gray-600'}`}
                                          />
                                          {flag === 'red' && <span className="text-[9px] text-red-500" title="High shortage">🔴 {diff?.toFixed(1)}%</span>}
                                          {flag === 'orange' && <span className="text-[9px] text-amber-500" title="More shortage">🟠 {diff?.toFixed(1)}%</span>}
                                          {flag === 'green' && diff !== null && diff < 0 && <span className="text-[9px] text-green-500">{diff?.toFixed(1)}%</span>}
                                          {expected > 0 && !actual && <span className="text-[9px] text-gray-400">~{expected.toFixed(0)}m</span>}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                </div>
                                {/* Slip details */}
                                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                                  {slips.map(slip => {
                                    const overrideKey = `${slip.slipNo}::${lotNo}`
                                    return (
                                    <div key={`${slip.slipNo}-${slip.lotNo}`} className="px-3 py-1.5 text-xs">
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500 dark:text-gray-400">Slip {slip.slipNo}</span>
                                        <input
                                          type="number"
                                          value={finishThanOverrides[overrideKey] ?? slip.than}
                                          onChange={e => setFinishThanOverrides(prev => ({ ...prev, [overrideKey]: e.target.value }))}
                                          className="w-14 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400 text-center font-medium"
                                        />
                                        <span className="text-gray-400">than</span>
                                      </div>
                                      {slip.shade && <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{slip.shade}</p>}
                                    </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>

                    {/* Per-lot summary + Total Meter (Sample E table) */}
                    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3">
                      {(() => {
                        // Aggregate by lotNo: total than + entered meter
                        const lotMap = new Map<string, { than: number; meter: number }>()
                        for (const lot of selectedLots.values()) {
                          const key = `${lot.slipNo}::${lot.lotNo}`
                          const ovr = finishThanOverrides[key]
                          const than = ovr ? parseInt(ovr) || 0 : lot.than
                          const existing = lotMap.get(lot.lotNo)
                          if (existing) existing.than += than
                          else lotMap.set(lot.lotNo, { than, meter: parseFloat(finishMeters[lot.lotNo] || '0') || 0 })
                        }
                        const rows = Array.from(lotMap.entries())
                        const totalThan = rows.reduce((s, [, v]) => s + v.than, 0)
                        const totalMeter = rows.reduce((s, [, v]) => s + v.meter, 0)
                        return (
                          <>
                            <table className="w-full text-xs mb-3">
                              <thead className="bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                <tr>
                                  <th className="text-left px-2 py-1.5">Lot No</th>
                                  <th className="text-right px-2 py-1.5 w-20">Than</th>
                                  <th className="text-right px-2 py-1.5 w-24">Meter</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {rows.map(([lotNo, v]) => (
                                  <tr key={lotNo}>
                                    <td className="px-2 py-1 font-medium text-teal-700 dark:text-teal-300">{lotNo}</td>
                                    <td className="px-2 py-1 text-right text-gray-700 dark:text-gray-200">{v.than}</td>
                                    <td className="px-2 py-1 text-right text-gray-700 dark:text-gray-200">{v.meter ? v.meter.toFixed(1) : '—'}</td>
                                  </tr>
                                ))}
                                {rows.length === 0 && (
                                  <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-400 italic">No lots selected.</td></tr>
                                )}
                              </tbody>
                              {rows.length > 0 && (
                                <tfoot>
                                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold text-emerald-700 dark:text-emerald-400">
                                    <td className="px-2 py-1.5">Total</td>
                                    <td className="px-2 py-1.5 text-right">{totalThan}</td>
                                    <td className="px-2 py-1.5 text-right">{totalMeter ? totalMeter.toFixed(1) : '—'}</td>
                                  </tr>
                                </tfoot>
                              )}
                            </table>
                            {/* Override total meter (carried over from previous design) */}
                            <div className="flex items-center gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                              <span className="text-xs text-gray-500 dark:text-gray-400">Override total meter:</span>
                              <input
                                type="number"
                                step="0.1"
                                placeholder="Override total"
                                value={finishTotalMeterOverride}
                                onChange={e => setFinishTotalMeterOverride(e.target.value)}
                                className="w-28 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400"
                              />
                              {finishTotalMeterOverride && (
                                <span className="text-xs text-amber-600 dark:text-amber-400">(override active)</span>
                              )}
                            </div>
                          </>
                        )
                      })()}
                    </div>


                    {/* Chemicals */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Chemicals</label>
                          <button type="button" onClick={fetchFinishRecipe} disabled={recipeFetching}
                            className="text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 px-2.5 py-1 rounded-lg font-medium disabled:opacity-50 transition border border-indigo-200 dark:border-indigo-800">
                            {recipeFetching ? 'Loading...' : 'Load Finish Recipe'}
                          </button>
                        </div>
                        <button type="button" onClick={addFinishChemical}
                          className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium">
                          + Add Chemical
                        </button>
                      </div>
                      {recipeMsg && (
                        <p className={`text-xs mb-2 ${recipeMsg.includes('Loaded') ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>{recipeMsg}</p>
                      )}
                      {showRecipePicker && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowRecipePicker(false)}>
                          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                              <div>
                                <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Select Recipe</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{recipePickerParty} — {recipePickerList.length} recipe{recipePickerList.length !== 1 ? 's' : ''}</p>
                              </div>
                              <button onClick={() => setShowRecipePicker(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                              {recipePickerList.map(r => (
                                <button
                                  key={r.id}
                                  onClick={() => applyRecipe(r)}
                                  className="w-full text-left bg-gray-50 dark:bg-gray-700/50 hover:bg-teal-50 dark:hover:bg-teal-900/20 border border-gray-200 dark:border-gray-600 hover:border-teal-300 dark:hover:border-teal-700 rounded-xl p-4 transition"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{r.quality.name}</span>
                                    <span className="text-xs text-gray-400 dark:text-gray-500">{r.items.length} chemical{r.items.length !== 1 ? 's' : ''}</span>
                                  </div>
                                  {r.variant && (
                                    <span className="inline-block text-[10px] bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded mb-1.5">{r.variant}</span>
                                  )}
                                  <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                                    {r.finishWidth && <span>FW: {r.finishWidth}</span>}
                                    {r.finalWidth && <span>Final: {r.finalWidth}</span>}
                                    {r.shortage && <span>Shortage: {r.shortage}</span>}
                                  </div>
                                  {r.items.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {r.items.slice(0, 6).map((item: any, i: number) => (
                                        <span key={i} className="inline-flex items-center gap-0.5 bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 text-[10px] px-1.5 py-0.5 rounded-full">
                                          {item.name} <span className="text-gray-400">({item.quantity}{item.unit})</span>
                                        </span>
                                      ))}
                                      {r.items.length > 6 && <span className="text-[10px] text-gray-400">+{r.items.length - 6}</span>}
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      {finishChemicals.length > 0 && (
                        <div className="space-y-2">
                          {finishChemicals.map((chem, ci) => (
                            <div key={ci} className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-1.5">
                              <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                  <input
                                    type="text"
                                    placeholder="Chemical name"
                                    value={chem.name}
                                    onChange={e => updateFinishChemical(ci, 'name', e.target.value)}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400"
                                    list={`chem-list-${ci}`}
                                  />
                                  <datalist id={`chem-list-${ci}`}>
                                    {masterChemicals.map(m => (
                                      <option key={m.id} value={m.name} onClick={() => selectFinishChemicalMaster(ci, m)} />
                                    ))}
                                  </datalist>
                                </div>
                                <button type="button" onClick={() => removeFinishChemical(ci)}
                                  className="text-red-400 hover:text-red-600 text-lg leading-none shrink-0">&times;</button>
                              </div>
                              <div className="flex items-center gap-2">
                                <input type="number" step="0.01" placeholder="Qty"
                                  value={chem.quantity} onChange={e => updateFinishChemical(ci, 'quantity', e.target.value)}
                                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                                <select value={chem.unit} onChange={e => updateFinishChemical(ci, 'unit', e.target.value)}
                                  className="w-14 border border-gray-300 dark:border-gray-600 rounded px-1 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400">
                                  <option value="kg">kg</option>
                                  <option value="ltr">ltr</option>
                                  <option value="gm">gm</option>
                                  <option value="ml">ml</option>
                                </select>
                                <input type="number" step="0.01" placeholder="Rate"
                                  value={chem.rate} onChange={e => updateFinishChemical(ci, 'rate', e.target.value)}
                                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                                {chem.cost != null && chem.cost > 0 && (
                                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">&#8377;{chem.cost.toFixed(0)}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Total Cost */}
                      {finishChemicals.length > 0 && (() => {
                        const totalCost = finishChemicals.reduce((s, c) => s + (c.cost ?? 0), 0)
                        return totalCost > 0 ? (
                          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-end">
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">
                              Total Cost: <span className="text-emerald-600 dark:text-emerald-400">{'\u20B9'}{totalCost.toLocaleString('en-IN')}</span>
                            </span>
                          </div>
                        ) : null
                      })()}
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                      <textarea value={finishNotes} onChange={e => setFinishNotes(e.target.value)}
                        rows={2} placeholder="Optional notes..."
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-2">
                      <button
                        onClick={handleFinishSubmit}
                        disabled={finishSaving}
                        className="bg-teal-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-teal-700 disabled:opacity-50 transition"
                      >
                        {finishSaving ? 'Saving...' : 'Save Finish Entry'}
                      </button>
                      <button onClick={cancelFinish} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
      )}

      {/* ═══ PACKING STOCK TAB ════════════════════════════════════════ */}
      {tab === 'packing' && (
        <div>
          {packingLoading ? <div className="p-12 text-center text-gray-400 dark:text-gray-500">Loading...</div> :
            packingPartyGroups.length === 0 ? <div className="p-12 text-center text-gray-400 dark:text-gray-500">No packing stock found.</div> : (
              <div className="space-y-3">
                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Parties</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">{packingPartyGroups.length}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Finish Programs</p>
                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400 mt-1">{packingEntries.length}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Than</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{packingTotalThan.toLocaleString()}</p>
                  </div>
                </div>

                {/* View toggle */}
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setPackView('party')}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${packView === 'party' ? 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}>
                    Party-wise
                  </button>
                  <button onClick={() => setPackView('desp')}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${packView === 'desp' ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}>
                    Desp Slip-wise
                  </button>
                </div>

                {/* Desp Slip view */}
                {packView === 'desp' && (
                  <div className="space-y-2">
                    <input type="text" value={despSearch} onChange={e => setDespSearch(e.target.value)}
                      placeholder="Search lot no, party..."
                      className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400" />
                    {selectedDesps.size > 0 && (
                      <div className="flex items-center gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2">
                        <span className="text-xs text-green-700 dark:text-green-300 font-medium">{selectedDesps.size} selected</span>
                        <button onClick={shareDespSlips} className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg font-medium">📤 Share</button>
                        <button onClick={() => setSelectedDesps(new Set())} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">Clear</button>
                      </div>
                    )}
                    {(() => {
                      const dq = despSearch.toLowerCase().trim()
                      const filteredPacking = dq ? packingEntries.filter(pe =>
                        pe.lots.some((l: any) =>
                          l.lotNo.toLowerCase().includes(dq) ||
                          (l.party || '').toLowerCase().includes(dq)
                        )
                      ) : packingEntries
                      const despMap = new Map<string, { slipNo: string; entries: typeof packingEntries }>()
                      for (const pe of filteredPacking) {
                        const key = pe.finishDespSlipNo || 'No Desp Slip'
                        if (!despMap.has(key)) despMap.set(key, { slipNo: key, entries: [] })
                        despMap.get(key)!.entries.push(pe)
                      }
                      return Array.from(despMap.entries()).map(([despNo, group]) => {
                        const isOpen = expandedDesp.has(despNo)
                        const totalThan = group.entries.reduce((s, e) => s + e.totalThan, 0)
                        const isSelected = selectedDesps.has(despNo)
                        return (
                          <div key={despNo} className={`bg-white dark:bg-gray-800 rounded-xl border shadow-sm overflow-hidden ${isSelected ? 'border-green-300 dark:border-green-700' : 'border-gray-100 dark:border-gray-700'}`}>
                            <div className="flex items-center">
                              <label className="flex items-center pl-4 cursor-pointer" onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={isSelected} onChange={() => toggleDespSelect(despNo)}
                                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500 dark:bg-gray-700" />
                              </label>
                              <button onClick={() => setExpandedDesp(prev => { const n = new Set(prev); if (n.has(despNo)) n.delete(despNo); else n.add(despNo); return n })}
                                className="flex-1 flex items-center justify-between px-3 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                                <div className="text-left">
                                  <span className={`text-sm font-bold ${despNo !== 'No Desp Slip' ? 'text-purple-700 dark:text-purple-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                    {despNo !== 'No Desp Slip' ? `Desp: ${despNo}` : 'No Desp Slip'}
                                  </span>
                                  <span className="text-[10px] text-gray-400 ml-2">{group.entries.length} FP{group.entries.length !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{totalThan}</span>
                                  <span className={`text-gray-400 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                                </div>
                              </button>
                            </div>
                            {isOpen && (
                              <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
                                {group.entries.map(pe => (
                                  <div key={pe.id} className="px-4 py-2.5">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-2 text-xs">
                                        <span className="font-medium text-teal-600 dark:text-teal-400">Finish_Prg {pe.slipNo}</span>
                                        {pe.isFromOB && <span className="text-[9px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-full">OB</span>}
                                        <span className="text-gray-400">{new Date(pe.date).toLocaleDateString('en-IN')}</span>
                                      </div>
                                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{pe.totalThan}</span>
                                    </div>
                                    <div className="space-y-2 mt-1">
                                      {pe.lots.map((l: any, li: number) => {
                                        const recs = l.foldingReceipts || []
                                        const received = recs.reduce((s: number, r: any) => s + r.than, 0)
                                        const complete = received >= l.than
                                        return (
                                          <div key={li} data-lot-card={l.lotNo} className={`rounded-lg p-2.5 border transition-shadow ${complete ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'}`}>
                                            <div className="flex items-center justify-between mb-1">
                                              <div className="flex items-center gap-2">
                                                <LotLink
                                                  lotNo={l.lotNo}
                                                  storageKey={FINISH_VIEW_KEY}
                                                  extra={{ lastClickedDesp: despNo }}
                                                  className="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline"
                                                >{l.lotNo}</LotLink>
                                                {l.foldNo && <span className="text-[9px] text-indigo-500">F{l.foldNo}</span>}
                                              </div>
                                              <span className="text-xs font-medium">{received}/{l.than} {complete ? '✅' : '⏳'}</span>
                                            </div>
                                            {recs.length > 0 && (
                                              <div className="space-y-0.5 mb-1">
                                                {recs.map((r: any) => (
                                                  <div key={r.id} className="flex items-center justify-between text-[10px]">
                                                    <span className="text-gray-500">Folding_recpt {r.slipNo} · {new Date(r.date).toLocaleDateString('en-IN')}</span>
                                                    <div className="flex items-center gap-1">
                                                      {frEditId === r.id ? (
                                                        <>
                                                          <input type="number" value={frEditThan} onChange={e => setFrEditThan(e.target.value)}
                                                            className="w-12 text-[10px] border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-center bg-white dark:bg-gray-700 dark:text-gray-100" />
                                                          <button onClick={editFoldingReceipt} className="text-[9px] text-teal-600 font-bold">Save</button>
                                                          <button onClick={() => setFrEditId(null)} className="text-[9px] text-gray-400">✕</button>
                                                        </>
                                                      ) : (
                                                        <>
                                                          <span className="font-medium text-gray-700 dark:text-gray-200">{r.than}</span>
                                                          <button onClick={() => { setFrEditId(r.id); setFrEditThan(String(r.than)) }} className="text-[9px] text-indigo-500 hover:underline">Edit</button>
                                                        </>
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                            {!complete && (
                                              <button onClick={() => {
                                                setFrFormLotId(l.id)
                                                setFrFormLotNo(l.lotNo)
                                                setFrFormFpNo(pe.slipNo)
                                                setFrFormMaxThan(l.than - received)
                                                setFrSlipNo('')
                                                setFrThan(String(l.than - received))
                                                setFrDate(new Date().toISOString().split('T')[0])
                                              }}
                                                className="text-[10px] text-teal-600 dark:text-teal-400 hover:text-teal-700 font-medium mt-1">+ Folding Receipt</button>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })
                    })()}
                  </div>
                )}

                {/* Party cards */}
                {packView === 'party' && packingPartyGroups.map(pg => {
                  const isOpen = packExpandedParties.has(pg.party)
                  return (
                    <div key={pg.party} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                      {/* Party header */}
                      <button
                        onClick={() => togglePackParty(pg.party)}
                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                      >
                        <div className="text-left">
                          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{pg.party}</h3>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                            {pg.totalSlips} slip{pg.totalSlips !== 1 ? 's' : ''} &middot; {pg.totalLots} lot{pg.totalLots !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{pg.totalThan} than</span>
                          <span className={`text-gray-400 dark:text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                        </div>
                      </button>

                      {/* Quality cards */}
                      {isOpen && (
                        <div className="border-t border-gray-100 dark:border-gray-700 px-3 pb-3 space-y-2 pt-2">
                          {pg.qualities.map(qg => {
                            const qKey = `pack::${pg.party}::${qg.quality}`
                            const qOpen = packExpandedQualities.has(qKey)
                            return (
                              <div key={qKey} className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => togglePackQuality(qKey)}
                                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                                >
                                  <div className="text-left">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                                      {qg.quality}
                                      {(() => {
                                        const rv = recipeVariantMap.get(`${pg.party.toLowerCase().trim()}::${qg.quality.toLowerCase().trim()}`)
                                        return rv ? <span className="ml-1.5 text-[10px] font-normal text-teal-600 dark:text-teal-400">({rv})</span> : null
                                      })()}
                                    </h4>
                                    {qg.weight && <p className="text-[10px] text-gray-400 dark:text-gray-500">Weight: {qg.weight}</p>}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{qg.totalThan} than</span>
                                    <span className={`text-gray-400 dark:text-gray-500 text-xs transition-transform ${qOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                                  </div>
                                </button>

                                {/* Slip details */}
                                {qOpen && (
                                  <div className="border-t border-gray-50 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
                                    {qg.slips.map(slip => {
                                      const qLots = slip.lots.filter(l => (l.quality ?? 'Unknown') === qg.quality && (l.party ?? 'Unknown') === pg.party)
                                      // Slip total mirrors the per-lot balance shown below: pack qty − received − despatched.
                                      const slipQualityThan = qLots.reduce((s, l) => {
                                        const recs = (l as any).foldingReceipts || []
                                        const rec = recs.reduce((x: number, r: any) => x + r.than, 0)
                                        const desp = (l as any).despatchedThan || 0
                                        return s + Math.max(0, l.than - rec - desp)
                                      }, 0)
                                      // Hide whole slip row if every lot in it is fully done.
                                      if (slipQualityThan <= 0) return null
                                      return (
                                        <div key={slip.id} className="px-3 py-2.5">
                                          <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                              {slip.finishDespSlipNo && (
                                                <span className="font-bold text-white bg-purple-600 dark:bg-purple-500 px-2 py-0.5 rounded text-[10px]">Desp: {slip.finishDespSlipNo}</span>
                                              )}
                                              <span className="font-medium text-teal-600 dark:text-teal-400">Finish_Prg {slip.slipNo}</span>
                                              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                                              <span>{new Date(slip.date).toLocaleDateString('en-IN')}</span>
                                            </div>
                                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{slipQualityThan}</span>
                                          </div>
                                          <div className="flex flex-wrap gap-1.5">
                                            {qLots.map((lot, li) => {
                                              const shade = shadeDisplay(lot.shadeName, lot.shadeDescription)
                                              const recs = (lot as any).foldingReceipts || []
                                              const received = recs.reduce((s: number, r: any) => s + r.than, 0)
                                              const despatched = (lot as any).despatchedThan || 0
                                              // Balance = pack qty − received in folding − already despatched
                                              const balance = lot.than - received - despatched
                                              // Hide lots that have been fully received/despatched (zero or less balance)
                                              if (balance <= 0) return null
                                              const partial = received > 0 || despatched > 0
                                              return (
                                                <div key={li} data-lot-card={lot.lotNo} className="inline-flex flex-col items-start gap-0.5">
                                                  <div className="inline-flex items-center gap-1">
                                                    <LotLink lotNo={lot.lotNo} storageKey={FINISH_VIEW_KEY}
                                                      className="inline-flex items-center gap-1 text-[11px] text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 px-2 py-0.5 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/30">
                                                      <span>{lot.lotNo}</span>
                                                      <span className="font-bold text-emerald-700 dark:text-emerald-300">{balance}</span>
                                                      {partial && (
                                                        <span className="text-[9px] text-gray-500 dark:text-gray-400">/{lot.than}</span>
                                                      )}
                                                    </LotLink>
                                                    {shade && <span className="text-[10px] text-gray-400 dark:text-gray-500">{shade}</span>}
                                                  </div>
                                                  {lot.meter != null && (
                                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-2">{Math.round(lot.meter)}m</span>
                                                  )}
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
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
        </div>
      )}

      {/* FR Add Popup Modal — top-level so it works across all tabs */}
      {frFormLotId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/40 p-4" onClick={() => setFrFormLotId(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">+ Folding Receipt</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Finish_Prg {frFormFpNo} · {frFormLotNo} · {frFormMaxThan} remaining</p>
              </div>
              <button onClick={() => setFrFormLotId(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Folding_recpt Slip No</label>
                  <input type="text" value={frSlipNo} onChange={e => setFrSlipNo(e.target.value)} placeholder="e.g. 45" autoFocus
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
                  <input type="date" value={frDate} onChange={e => setFrDate(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Than</label>
                <input type="number" value={frThan} onChange={e => setFrThan(e.target.value)} placeholder="Than"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              <div className="flex items-center justify-end gap-3 pt-1">
                <button onClick={() => setFrFormLotId(null)}
                  className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium">Cancel</button>
                <button onClick={addFoldingReceipt} disabled={frSaving || !frSlipNo || !frThan}
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {frSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Reusable sortable table header ───────────────────────────────── */

function ThSort({ field, label, active, dir, toggle, right }: {
  field: SortField; label: string; active: SortField; dir: SortDir; toggle: (f: SortField) => void; right?: boolean
}) {
  const isActive = active === field
  return (
    <th onClick={() => toggle(field)}
      className={`px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-teal-600 dark:hover:text-teal-400 ${right ? 'text-right' : 'text-left'}`}>
      <span className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
        {label}
        <span className={isActive ? 'text-teal-600 dark:text-teal-400' : 'text-gray-300 dark:text-gray-600'}>
          {isActive ? (dir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
        </span>
      </span>
    </th>
  )
}
