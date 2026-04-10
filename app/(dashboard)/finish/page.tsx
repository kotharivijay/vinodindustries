'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../BackButton'

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
}

interface StockEntry {
  id: number
  slipNo: number
  date: string
  shadeName: string | null
  shadeDescription: string | null
  marka: string | null
  isPcJob: boolean
  machineName: string | null
  operatorName: string | null
  lots: StockLot[]
  totalThan: number
}

type SortField = 'date' | 'slipNo' | 'lotNo' | 'party' | 'quality' | 'than'
type SortDir = 'asc' | 'desc'
type Tab = 'slips' | 'register' | 'report' | 'packing'

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

interface FinishSlipEntry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  meter: number | null
  mandi: number | null
  notes: string | null
  lots: FinishLot[]
  chemicals: FinishSlipChemical[]
  partyName: string | null
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
  lots: StockLot[]
  totalThan: number
  machineName: string | null
  operatorName: string | null
}

interface QualityGroup {
  quality: string
  weight: string | null
  totalThan: number
  slips: SlipDetail[]
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
}

interface PackingEntry {
  id: number
  slipNo: number
  date: string
  meter: number | null
  mandi: number | null
  notes: string | null
  lots: PackingLot[]
  totalThan: number
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
  void router

  const { data: rawData, isLoading: loading, mutate: mutateStock } = useSWR<{ stock: StockEntry[]; totalSlips: number; totalThan: number }>('/api/finish/stock', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  const entries = rawData?.stock ?? []

  const { data: packingRaw, isLoading: packingLoading } = useSWR<{ stock: PackingEntry[]; totalSlips: number; totalThan: number }>('/api/finish/packing', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
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

  const [tab, setTab] = useState<Tab>('slips')

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
  const [editNotes, setEditNotes] = useState('')
  const [editLots, setEditLots] = useState<{ lotNo: string; than: string; meter: string }[]>([])
  const [editChemicals, setEditChemicals] = useState<FinishChemicalRow[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const startEdit = useCallback(async (entry: FinishSlipEntry) => {
    setEditingSlipId(entry.id)
    setEditDate(new Date(entry.date).toISOString().split('T')[0])
    setEditSlipNo(String(entry.slipNo))
    setEditMandi(entry.mandi != null ? String(entry.mandi) : '')
    setEditNotes(entry.notes ?? '')
    setEditLots(entry.lots.map(l => ({ lotNo: l.lotNo, than: String(l.than), meter: l.meter != null ? String(l.meter) : '' })))
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
    setEditError('')
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
    if (!editSlipNo.trim()) { setEditError('Slip No is required.'); return }
    setEditSaving(true)
    setEditError('')

    const totalMeter = editLots.reduce((s, l) => s + (parseFloat(l.meter) || 0), 0)

    const payload = {
      date: editDate,
      slipNo: editSlipNo,
      notes: editNotes || null,
      mandi: editMandi ? parseFloat(editMandi) : null,
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
      } else {
        const d = await res.json().catch(() => ({}))
        setEditError(d.error ?? 'Failed to save')
      }
    } catch {
      setEditError('Network error')
    }
    setEditSaving(false)
  }, [editingSlipId, editDate, editSlipNo, editNotes, editMandi, editLots, editChemicals, mutateSlips, mutateStock])

  const handleDelete = useCallback(async (id: number) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/finish/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setDeleteConfirmId(null)
        mutateSlips()
        mutateStock()
      }
    } catch { /* ignore */ }
    setDeleting(false)
  }, [mutateSlips, mutateStock])

  /* ── Stock Report grouped data ──────────────────────────────────── */

  const partyGroups = useMemo<PartyGroup[]>(() => {
    // Flatten: for each entry, for each lot, produce a record
    const records: { party: string; quality: string; weight: string | null; slip: SlipDetail; lotNo: string; than: number }[] = []
    for (const e of entries) {
      for (const l of e.lots) {
        records.push({
          party: l.party ?? 'Unknown',
          quality: l.quality ?? 'Unknown',
          weight: l.weight,
          slip: e,
          lotNo: l.lotNo,
          than: l.than,
        })
      }
    }

    // Group by party
    const partyMap = new Map<string, Map<string, { weight: string | null; slipSet: Set<number>; slips: Map<number, SlipDetail>; totalThan: number; lotSet: Set<string> }>>()
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

    const result: PartyGroup[] = []
    for (const [party, qMap] of partyMap) {
      const qualities: QualityGroup[] = []
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
  }, [entries])

  /* ── Stock Report expand state ─────────────────────────────────── */
  const [expandedParties, setExpandedParties] = useState<Set<string>>(new Set())
  const [expandedQualities, setExpandedQualities] = useState<Set<string>>(new Set())

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
  const [finishChemicals, setFinishChemicals] = useState<FinishChemicalRow[]>([])
  const [finishSaving, setFinishSaving] = useState(false)
  const [finishError, setFinishError] = useState('')
  const [finishTotalMeterOverride, setFinishTotalMeterOverride] = useState('')
  const [recipeFetching, setRecipeFetching] = useState(false)
  const [recipeMsg, setRecipeMsg] = useState('')

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
    // Load chemicals master
    if (!chemLoaded) {
      try {
        const res = await fetch('/api/chemicals')
        const data = await res.json()
        setMasterChemicals(Array.isArray(data) ? data : [])
        setChemLoaded(true)
      } catch { /* ignore */ }
    }
  }, [chemLoaded])

  const cancelFinish = useCallback(() => {
    setShowFinishForm(false)
    setFinishChemicals([])
    setFinishMeters({})
    setFinishMandi('')
    setFinishNotes('')
    setFinishError('')
    setFinishTotalMeterOverride('')
    setRecipeMsg('')
  }, [])

  const fetchFinishRecipe = useCallback(async () => {
    // Determine party + quality from selected lots
    const firstLot = Array.from(selectedLots.values())[0]
    if (!firstLot) { setRecipeMsg('No lots selected.'); return }
    const partyName = firstLot.party
    const qualityName = firstLot.quality
    if (!partyName || partyName === 'Unknown' || !qualityName || qualityName === 'Unknown') {
      setRecipeMsg('Could not determine party/quality from selected lots.')
      return
    }
    setRecipeFetching(true)
    setRecipeMsg('')
    try {
      // Look up party and quality IDs
      const [partiesRes, qualitiesRes] = await Promise.all([
        fetch('/api/masters/parties').then(r => r.json()),
        fetch('/api/masters/qualities').then(r => r.json()),
      ])
      const party = (partiesRes as any[]).find((p: any) => p.name === partyName)
      const quality = (qualitiesRes as any[]).find((q: any) => q.name === qualityName)
      if (!party || !quality) {
        setRecipeMsg(`No recipe found for ${partyName} / ${qualityName}`)
        setRecipeFetching(false)
        return
      }
      const recipeRes = await fetch(`/api/finish/recipe?partyId=${party.id}&qualityId=${quality.id}`)
      const recipe = await recipeRes.json()
      if (!recipe || !recipe.id) {
        setRecipeMsg(`No recipe found for ${partyName} / ${qualityName}`)
        setRecipeFetching(false)
        return
      }
      // Populate chemicals from recipe items
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
      const tagNote = recipe.isTagged ? ` (using recipe from ${recipe.taggedFrom})` : ''
      setRecipeMsg(`Loaded recipe: ${recipe.items.length} chemical(s) for ${partyName} / ${qualityName}${tagNote}`)
    } catch {
      setRecipeMsg('Failed to fetch recipe.')
    }
    setRecipeFetching(false)
  }, [selectedLots])

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
    if (!finishSlipNo.trim()) { setFinishError('Slip No is required.'); return }
    setFinishSaving(true)
    setFinishError('')

    // Group selected lots by lotNo and sum than
    const lotMap = new Map<string, { lotNo: string; than: number }>()
    for (const l of selectedLots.values()) {
      const existing = lotMap.get(l.lotNo)
      if (existing) existing.than += l.than
      else lotMap.set(l.lotNo, { lotNo: l.lotNo, than: l.than })
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
        setFinishMandi('')
        setFinishNotes('')
        setFinishSaving(false)
        // Live refresh data
        mutateSlips()
        mutateStock()
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
        records.push({
          party: l.party ?? 'Unknown',
          quality: l.quality ?? 'Unknown',
          weight: l.weight,
          slip: { id: pe.id, slipNo: pe.slipNo, date: pe.date, lots: pe.lots, totalThan: pe.totalThan, meter: pe.meter },
          lotNo: l.lotNo,
          than: l.than,
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
  const [packExpandedParties, setPackExpandedParties] = useState<Set<string>>(new Set())
  const [packExpandedQualities, setPackExpandedQualities] = useState<Set<string>>(new Set())

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
        {([['slips', 'Finish Slip Register'], ['register', 'Stock Register'], ['report', 'Stock Report'], ['packing', 'Packing Stock']] as [Tab, string][]).map(([key, label]) => (
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
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Slip No</label>
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
              {([['date', 'Date'], ['slipNo', 'Slip'], ['lotNo', 'Lot'], ['party', 'Party'], ['than', 'Than']] as [SlipSortField, string][]).map(([f, label]) => (
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
                      <div key={entry.id} className="bg-white dark:bg-gray-800 rounded-xl border-2 border-teal-300 dark:border-teal-700 shadow-lg p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Edit Finish Slip #{entry.slipNo}</h2>
                          <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
                        </div>

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
                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Slip No</label>
                            <input type="number" value={editSlipNo} onChange={e => setEditSlipNo(e.target.value)}
                              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                          </div>
                        </div>

                        {/* Lots */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Lots</label>
                          <div className="space-y-2">
                            {editLots.map((lot, li) => (
                              <div key={li} className="grid grid-cols-3 gap-2 items-center">
                                <div>
                                  <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Lot No</label>
                                  <input type="text" value={lot.lotNo}
                                    onChange={e => setEditLots(prev => { const u = [...prev]; u[li] = { ...u[li], lotNo: e.target.value }; return u })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                                </div>
                                <div>
                                  <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Than</label>
                                  <input type="number" value={lot.than}
                                    onChange={e => setEditLots(prev => { const u = [...prev]; u[li] = { ...u[li], than: e.target.value }; return u })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                                </div>
                                <div>
                                  <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Meter</label>
                                  <input type="number" step="0.1" value={lot.meter}
                                    onChange={e => setEditLots(prev => { const u = [...prev]; u[li] = { ...u[li], meter: e.target.value }; return u })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Mandi */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Mandi (liters)</label>
                          <input type="number" step="0.1" value={editMandi} onChange={e => setEditMandi(e.target.value)}
                            placeholder="Liters"
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                        </div>

                        {/* Chemicals */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Chemicals</label>
                            <button type="button" onClick={addEditChemical}
                              className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium">
                              + Add Chemical
                            </button>
                          </div>
                          {editChemicals.length > 0 && (
                            <div className="space-y-2">
                              {editChemicals.map((chem, ci) => (
                                <div key={ci} className="flex items-center gap-2">
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
                                  {chem.cost != null && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400 w-14 text-right">{chem.cost.toFixed(0)}</span>
                                  )}
                                  <button type="button" onClick={() => removeEditChemical(ci)}
                                    className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
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
                    )
                  }

                  return (
                    <div key={entry.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <span>{new Date(entry.date).toLocaleDateString('en-IN')}</span>
                          <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                          <span className="text-teal-600 dark:text-teal-400 font-medium">Slip {entry.slipNo}</span>
                          {entry.mandi != null && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                              <span>Mandi: {entry.mandi}L</span>
                            </>
                          )}
                          {entry.chemicals.length > 0 && (
                            <>
                              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                              <span>{entry.chemicals.length} chemical{entry.chemicals.length !== 1 ? 's' : ''}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{totalThanEntry}T</span>
                          {totalMeter > 0 && <span className="text-xs text-gray-400 dark:text-gray-500">{totalMeter}m</span>}
                        </div>
                      </div>

                      {/* Lots */}
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        {entry.lots.map((lot, li) => (
                          <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                            className="inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/30">
                            {lot.lotNo} <span className="text-teal-400 dark:text-teal-500 font-normal">({lot.than}T{lot.meter != null ? ` / ${lot.meter}m` : ''})</span>
                          </Link>
                        ))}
                      </div>

                      {/* Party + notes */}
                      {entry.partyName && <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">{entry.partyName}</p>}
                      {entry.notes && <p className="text-xs text-gray-500 dark:text-gray-400 italic mb-1">{entry.notes}</p>}

                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                        <button onClick={() => startEdit(entry)}
                          className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium">
                          Edit
                        </button>
                        {deleteConfirmId === entry.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-600 dark:text-red-400">Delete this entry?</span>
                            <button onClick={() => handleDelete(entry.id)} disabled={deleting}
                              className="text-xs text-red-600 dark:text-red-400 font-bold hover:text-red-700 disabled:opacity-50">
                              {deleting ? 'Deleting...' : 'Yes'}
                            </button>
                            <button onClick={() => setDeleteConfirmId(null)}
                              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                              No
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirmId(entry.id)}
                            className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 font-medium">
                            Delete
                          </button>
                        )}
                      </div>
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

      {/* ═══ STOCK REGISTER TAB ═══════════════════════════════════════ */}
      {tab === 'register' && (
        <>
          {/* Filters + Sort */}
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Slip No</label>
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
                              <span className="text-teal-600 dark:text-teal-400 font-medium">Slip {e.slipNo}</span>
                            </div>
                            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{e.totalThan}T</span>
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
                          <ThSort field="slipNo" label="Slip" active={sortField} dir={sortDir} toggle={toggleSort} />
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

                {/* Party cards */}
                {partyGroups.map(pg => {
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
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{qg.quality}</h4>
                                    {qg.weight && <p className="text-[10px] text-gray-400 dark:text-gray-500">Weight: {qg.weight}</p>}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{qg.totalThan} than</span>
                                    <span className={`text-gray-400 dark:text-gray-500 text-xs transition-transform ${qOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                                  </div>
                                </button>

                                {/* Level 3: Slip details inside quality */}
                                {qOpen && (
                                  <div className="border-t border-gray-50 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
                                    {qg.slips.map(slip => {
                                      const shade = shadeDisplay(slip.shadeName, slip.shadeDescription)
                                      // Filter lots that belong to this quality
                                      const qLots = slip.lots.filter(l => (l.quality ?? 'Unknown') === qg.quality && (l.party ?? 'Unknown') === pg.party)
                                      const slipQualityThan = qLots.reduce((s, l) => s + l.than, 0)
                                      return (
                                        <div key={slip.id} className="px-3 py-2.5">
                                          <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                              <span className="font-medium text-teal-600 dark:text-teal-400">Slip {slip.slipNo}</span>
                                              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                                              <span>{new Date(slip.date).toLocaleDateString('en-IN')}</span>
                                            </div>
                                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{slipQualityThan}T</span>
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
                                                  <Link href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                                    onClick={e => e.stopPropagation()}
                                                    className={`inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/30 ${isSelected ? 'bg-teal-200 dark:bg-teal-800/40 text-teal-800 dark:text-teal-200 font-bold' : 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'}`}>
                                                    {lot.lotNo}<span className="text-teal-400 dark:text-teal-500">({lot.than})</span>
                                                  </Link>
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
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Slip No</label>
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
                            const totalThan = slips.reduce((s, l) => s + l.than, 0)
                            return (
                              <div key={lotNo} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                {/* Lot header */}
                                <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 flex items-center justify-between">
                                  <span className="font-bold text-teal-700 dark:text-teal-300 text-sm">{lotNo}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Total: <strong className="text-gray-800 dark:text-gray-200">{totalThan} than</strong></span>
                                    <input
                                      type="number"
                                      step="0.1"
                                      placeholder="Meter"
                                      value={finishMeters[lotNo] ?? ''}
                                      onChange={e => setFinishMeters(prev => ({ ...prev, [lotNo]: e.target.value }))}
                                      className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400"
                                    />
                                  </div>
                                </div>
                                {/* Slip details */}
                                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                                  {slips.map(slip => (
                                    <div key={`${slip.slipNo}-${slip.lotNo}`} className="px-3 py-1.5 flex items-center justify-between text-xs">
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500 dark:text-gray-400">Slip {slip.slipNo}</span>
                                        <span className="text-gray-600 dark:text-gray-300 font-medium">{slip.than} than</span>
                                      </div>
                                      <span className="text-gray-500 dark:text-gray-400 truncate max-w-[180px]">{slip.shade || '\u2014'}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>

                    {/* Total Meter */}
                    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-3">
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Total Meter</label>
                      {(() => {
                        const autoMeter = Object.values(finishMeters).reduce((s, v) => s + (parseFloat(v) || 0), 0)
                        return (
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-600 dark:text-gray-300">
                              Auto: <strong className="text-emerald-600 dark:text-emerald-400">{autoMeter || 0} mtr</strong>
                            </span>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <input
                              type="number"
                              step="0.1"
                              placeholder="Override total"
                              value={finishTotalMeterOverride}
                              onChange={e => setFinishTotalMeterOverride(e.target.value)}
                              className="w-28 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400"
                            />
                            {finishTotalMeterOverride && (
                              <span className="text-xs text-amber-600 dark:text-amber-400">(override)</span>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Mandi */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Mandi (liters)</label>
                      <input type="number" step="0.1" value={finishMandi} onChange={e => setFinishMandi(e.target.value)}
                        placeholder="Liters"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
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
                      {finishChemicals.length > 0 && (
                        <div className="space-y-2">
                          {finishChemicals.map((chem, ci) => (
                            <div key={ci} className="flex items-center gap-2">
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
                              <input type="number" step="0.01" placeholder="Qty"
                                value={chem.quantity} onChange={e => updateFinishChemical(ci, 'quantity', e.target.value)}
                                className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                              <select value={chem.unit} onChange={e => updateFinishChemical(ci, 'unit', e.target.value)}
                                className="w-14 border border-gray-300 dark:border-gray-600 rounded px-1 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400">
                                <option value="kg">kg</option>
                                <option value="ltr">ltr</option>
                                <option value="gm">gm</option>
                                <option value="ml">ml</option>
                              </select>
                              <input type="number" step="0.01" placeholder="Rate"
                                value={chem.rate} onChange={e => updateFinishChemical(ci, 'rate', e.target.value)}
                                className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                              {chem.cost != null && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 w-14 text-right">{chem.cost.toFixed(0)}</span>
                              )}
                              <button type="button" onClick={() => removeFinishChemical(ci)}
                                className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
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
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Finish Slips</p>
                    <p className="text-2xl font-bold text-teal-600 dark:text-teal-400 mt-1">{packingEntries.length}</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total Than</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{packingTotalThan.toLocaleString()}</p>
                  </div>
                </div>

                {/* Party cards */}
                {packingPartyGroups.map(pg => {
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
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{qg.quality}</h4>
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
                                      const slipQualityThan = qLots.reduce((s, l) => s + l.than, 0)
                                      return (
                                        <div key={slip.id} className="px-3 py-2.5">
                                          <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                              <span className="font-medium text-teal-600 dark:text-teal-400">Finish Slip {slip.slipNo}</span>
                                              <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                                              <span>{new Date(slip.date).toLocaleDateString('en-IN')}</span>
                                              {slip.meter != null && (
                                                <>
                                                  <span className="text-gray-300 dark:text-gray-600">&middot;</span>
                                                  <span>{slip.meter}m</span>
                                                </>
                                              )}
                                            </div>
                                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{slipQualityThan}T</span>
                                          </div>
                                          <div className="flex flex-wrap gap-1.5">
                                            {qLots.map((lot, li) => {
                                              const shade = shadeDisplay(lot.shadeName, lot.shadeDescription)
                                              return (
                                                <div key={li} className="inline-flex items-center gap-1">
                                                  <Link href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                                    className="inline-flex items-center gap-0.5 text-[11px] text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 px-2 py-0.5 rounded-full hover:bg-teal-100 dark:hover:bg-teal-900/30">
                                                    {lot.lotNo}<span className="text-teal-400 dark:text-teal-500">({lot.than})</span>
                                                  </Link>
                                                  {shade && <span className="text-[10px] text-gray-400 dark:text-gray-500">{shade}</span>}
                                                  {lot.meter != null && <span className="text-[10px] text-gray-400 dark:text-gray-500">{lot.meter}m</span>}
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
