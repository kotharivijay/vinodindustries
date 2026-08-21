'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../BackButton'
import { downloadDeliveryChallanPdf } from '@/lib/delivery-challan-pdf'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface QueueRow {
  felId: number
  lotNo: string
  than: number
  meter: number | null
  quality: string
  shade: string | null
  shadeCategory: string | null
  dyeSlipNo: number | null
}
interface QueueFp {
  finishEntryId: number
  finishSlipNo: number
  date: string
  totalThan: number
  rows: QueueRow[]
}
interface QueueParty {
  partyId: number
  partyName: string
  partyTag: string | null
  totalThan: number
  finishPrograms: QueueFp[]
}

interface ChallanLine {
  id: number
  lotNo: string
  qualityName: string | null
  shadeName: string | null
  shadeCategory: string | null
  than: number
  finishSlipNo: number
  transportName: string | null
  transportLrNo: string | null
  marka: string | null
  greyChallanNo: string | null
  dyeSlipNo: number | null
}
interface Challan {
  id: number
  challanNo: number
  date: string
  status: string
  transport: string | null
  lrNo: string | null
  vehicleNo: string | null
  destination: string | null
  showExtraCharges: boolean
  party: { id: number; name: string; tag: string | null; gstin: string | null; address: string | null; state: string | null }
  lines: ChallanLine[]
}

export default function DeliveryChallanPage() {
  const [tab, setTab] = useState<'queue' | 'issued'>('queue')
  const { data: queue, mutate: mutateQueue } = useSWR<{ parties: QueueParty[] }>(
    '/api/delivery-challan/queue',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 20_000 },
  )
  const { data: issued, mutate: mutateIssued } = useSWR<Challan[]>(
    '/api/delivery-challan',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 20_000 },
  )

  // Selection per (partyId, felId)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Optional manual challan number. When set for a multi-party batch, the
  // first challan uses this number and subsequent ones auto-increment from
  // there. Accepts a bare integer.
  const [manualDcNo, setManualDcNo] = useState('')

  // Issued-tab controls
  const [issuedQuery, setIssuedQuery] = useState('')
  const [issuedPartyFilter, setIssuedPartyFilter] = useState<'all' | string>('all')
  const [issuedSort, setIssuedSort] = useState<'challan_desc' | 'challan_asc' | 'date_desc' | 'party' | 'than_desc'>('challan_desc')
  // Show/hide the Transport column in the on-screen challan detail table.
  // Hidden by default (matches the printed challan, which drops Transport).
  const [showTransport, setShowTransport] = useState(false)

  // Settings-gated edit mode: add missed than / remove wrongly-added lines on
  // an already-issued challan. Off by default; opt-in and persisted so it's a
  // deliberate action, not something normal users trip over.
  const [editMode, setEditMode] = useState(false)
  useEffect(() => { try { setEditMode(localStorage.getItem('dc-edit-mode') === 'true') } catch {} }, [])
  const setEdit = (v: boolean) => { setEditMode(v); try { localStorage.setItem('dc-edit-mode', String(v)) } catch {} ; if (!v) { setAddPanelFor(null); setAddPick(new Set()) } }
  const [addPanelFor, setAddPanelFor] = useState<number | null>(null) // challanId with add-panel open
  const [addPick, setAddPick] = useState<Set<number>>(new Set())
  const [editBusy, setEditBusy] = useState(false)

  // Queue finish-lots available to add, grouped by party id
  const availByParty = useMemo(() => {
    const m = new Map<number, { felId: number; lotNo: string; than: number; quality: string; shade: string | null; fpSlipNo: number; dyeSlipNo: number | null }[]>()
    for (const p of queue?.parties ?? []) {
      const rows: { felId: number; lotNo: string; than: number; quality: string; shade: string | null; fpSlipNo: number; dyeSlipNo: number | null }[] = []
      for (const fp of p.finishPrograms) for (const r of fp.rows) rows.push({ felId: r.felId, lotNo: r.lotNo, than: r.than, quality: r.quality, shade: r.shade, fpSlipNo: fp.finishSlipNo, dyeSlipNo: r.dyeSlipNo })
      if (rows.length) m.set(p.partyId, rows)
    }
    return m
  }, [queue])

  async function editLines(challanId: number, payload: { addFelIds?: number[]; removeLineIds?: number[]; edits?: { lineId: number; than: number }[] }) {
    setEditBusy(true)
    try {
      const res = await fetch(`/api/delivery-challan/${challanId}/edit-lines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.message || e.error || 'Edit failed'); return }
      setAddPanelFor(null); setAddPick(new Set())
      mutateIssued(); mutateQueue()
    } finally { setEditBusy(false) }
  }
  function removeLine(challanId: number, line: ChallanLine) {
    if (!confirm(`Remove ${line.lotNo} (${line.than} than) from this challan? It returns to the queue.`)) return
    editLines(challanId, { removeLineIds: [line.id] })
  }
  // Save vehicle no / destination on a challan (optimistic).
  async function saveChallanField(c: Challan, field: 'vehicleNo' | 'destination', value: string) {
    const v = value.trim() || null
    if ((c as any)[field] === v) return
    mutateIssued((prev) => (prev ?? []).map(x => x.id === c.id ? { ...x, [field]: v } : x), { revalidate: false })
    const res = await fetch(`/api/delivery-challan/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: v }),
    })
    if (!res.ok) { mutateIssued(); alert('Save failed') } else mutateIssued()
  }
  function editThan(challanId: number, line: ChallanLine) {
    const raw = prompt(`New than for ${line.lotNo} (dye slip ${line.dyeSlipNo ?? '?'}).\nCurrent ${line.than}. Reducing frees the difference back to the queue.`, String(line.than))
    if (raw == null) return
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 1) { alert('Enter a valid than (≥ 1).'); return }
    if (n === line.than) return
    if (n > line.than) { alert(`Cannot exceed ${line.than}. To add more, use "+ Add lots".`); return }
    editLines(challanId, { edits: [{ lineId: line.id, than: n }] })
  }

  const issuedPartyOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of issued ?? []) if (c.party?.name) set.add(c.party.name)
    return [...set].sort()
  }, [issued])

  const filteredIssued = useMemo(() => {
    const q = issuedQuery.trim().toLowerCase()
    const filtered = (issued ?? []).filter(c => {
      if (issuedPartyFilter !== 'all' && c.party?.name !== issuedPartyFilter) return false
      if (!q) return true
      if (String(c.challanNo).includes(q)) return true
      if (c.party?.name?.toLowerCase().includes(q)) return true
      if (c.lines.some(l => l.lotNo.toLowerCase().includes(q))) return true
      const totalThan = c.lines.reduce((s, l) => s + l.than, 0)
      if (String(totalThan) === q) return true
      return false
    })
    const totalThanOf = (c: Challan) => c.lines.reduce((s, l) => s + l.than, 0)
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      switch (issuedSort) {
        case 'challan_asc':  return a.challanNo - b.challanNo
        case 'challan_desc': return b.challanNo - a.challanNo
        case 'date_desc':    return new Date(b.date).getTime() - new Date(a.date).getTime()
        case 'party':        return (a.party?.name || '').localeCompare(b.party?.name || '')
        case 'than_desc':    return totalThanOf(b) - totalThanOf(a)
        default:             return 0
      }
    })
    return sorted
  }, [issued, issuedQuery, issuedPartyFilter, issuedSort])

  const parties = queue?.parties ?? []
  const selectedByParty = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const p of parties) {
      const ids: number[] = []
      for (const fp of p.finishPrograms) for (const r of fp.rows) if (picked.has(r.felId)) ids.push(r.felId)
      if (ids.length) m.set(p.partyId, ids)
    }
    return m
  }, [parties, picked])

  function togglePick(id: number) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllInFp(fp: QueueFp) {
    const ids = fp.rows.map(r => r.felId)
    setPicked(prev => {
      const next = new Set(prev)
      const allIn = ids.every(id => next.has(id))
      if (allIn) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }
  function togglePartyAll(p: QueueParty) {
    const ids: number[] = []
    for (const fp of p.finishPrograms) for (const r of fp.rows) ids.push(r.felId)
    setPicked(prev => {
      const next = new Set(prev)
      const allIn = ids.every(id => next.has(id))
      if (allIn) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  async function createChallans() {
    if (selectedByParty.size === 0) return
    setCreating(true)
    setError(null)
    // Parse manual seed if provided
    let seed: number | null = null
    if (manualDcNo.trim()) {
      const raw = manualDcNo.trim().replace(/^DC-?/i, '')
      const parsed = parseInt(raw)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Challan no. must be a positive integer')
        setCreating(false)
        return
      }
      seed = parsed
    }
    try {
      let offset = 0
      for (const [partyId, felIds] of selectedByParty.entries()) {
        const body: any = { partyId, finishEntryLotIds: felIds }
        if (seed != null) body.challanNo = seed + offset
        const res = await fetch('/api/delivery-challan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.message || err.error || 'Create failed')
        }
        offset++
      }
      setPicked(new Set())
      setManualDcNo('')
      mutateQueue()
      mutateIssued()
      setTab('issued')
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong')
    } finally {
      setCreating(false)
    }
  }

  async function cancelChallan(c: Challan) {
    if (!confirm(`Cancel challan ${c.challanNo}? Its finish-lots return to the queue.`)) return
    const res = await fetch(`/api/delivery-challan/${c.id}`, { method: 'DELETE' })
    if (res.ok) { mutateQueue(); mutateIssued() }
    else alert((await res.json()).message ?? 'Cancel failed')
  }

  // Flip the per-challan "Show Extra Charges" switch. Optimistic update so
  // the toggle feels instant; rolls back on API failure.
  async function toggleExtraCharges(c: Challan) {
    const next = !c.showExtraCharges
    mutateIssued(
      (prev) => (prev ?? []).map(x => x.id === c.id ? { ...x, showExtraCharges: next } : x),
      { revalidate: false },
    )
    const res = await fetch(`/api/delivery-challan/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showExtraCharges: next }),
    })
    if (!res.ok) {
      mutateIssued()
      alert('Toggle failed')
    } else {
      mutateIssued()
    }
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <h1 className="text-xl font-bold">Delivery Challan</h1>
        <div />
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setTab('queue')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
            tab === 'queue'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-500'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          Queue {parties.length > 0 && (
            <span className="ml-1 text-xs opacity-70">
              ({parties.reduce((s, p) => s + p.finishPrograms.reduce((a, fp) => a + fp.rows.length, 0), 0)})
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('issued')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
            tab === 'issued'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-500'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          Issued Challans {issued && issued.length > 0 && <span className="ml-1 text-xs opacity-70">({issued.length})</span>}
        </button>
      </div>

      {tab === 'queue' && (
        <>
          <div className="sticky top-0 z-30 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur p-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs">
              <span className="text-gray-700 dark:text-gray-300 font-semibold">{picked.size}</span>
              <span className="text-gray-500 dark:text-gray-400"> lots selected across </span>
              <span className="text-gray-700 dark:text-gray-300 font-semibold">{selectedByParty.size}</span>
              <span className="text-gray-500 dark:text-gray-400"> party group(s)</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                Challan no
                <input
                  value={manualDcNo}
                  onChange={e => setManualDcNo(e.target.value)}
                  placeholder="auto"
                  className="w-24 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1 placeholder-gray-400 dark:placeholder-gray-500"
                />
              </label>
              <button
                onClick={createChallans}
                disabled={selectedByParty.size === 0 || creating}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white text-xs font-semibold disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:text-gray-500 dark:disabled:text-gray-400"
              >
                {creating ? 'Creating…' : `Create ${selectedByParty.size} challan${selectedByParty.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs p-3">
              {error}
            </div>
          )}

          {parties.length === 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              No PC Pali finished cloth pending delivery.
            </div>
          )}

          <div className="space-y-3">
            {parties.map(p => (
              <div key={p.partyId} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-sm font-bold flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.finishPrograms.every(fp => fp.rows.every(r => picked.has(r.felId)))}
                      onChange={() => togglePartyAll(p)}
                      className="accent-emerald-600"
                    />
                    {p.partyName}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">
                      Pali PC Job → Delivery Challan
                    </span>
                  </label>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    {p.totalThan} than · {p.finishPrograms.length} finish program{p.finishPrograms.length === 1 ? '' : 's'}
                  </div>
                </div>
                {p.finishPrograms.map(fp => {
                  // Sort rows within FP by shade category for a clean visual
                  const byCat = new Map<string, QueueRow[]>()
                  for (const r of fp.rows) {
                    const k = r.shadeCategory || 'Uncategorised'
                    if (!byCat.has(k)) byCat.set(k, [])
                    byCat.get(k)!.push(r)
                  }
                  const catNames = [...byCat.keys()].sort()
                  return (
                    <div key={fp.finishEntryId} className="border-t border-gray-200 dark:border-gray-700 p-3">
                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 overflow-hidden">
                        <div className="px-3 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fp.rows.every(r => picked.has(r.felId))}
                              onChange={() => toggleAllInFp(fp)}
                              className="accent-emerald-600"
                            />
                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">FP-{fp.finishSlipNo}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{new Date(fp.date).toLocaleDateString('en-IN')}</span>
                          </label>
                          <div className="text-xs text-gray-600 dark:text-gray-300">{fp.totalThan} than</div>
                        </div>
                        {catNames.map(cat => {
                          const rows = byCat.get(cat)!
                          const catThan = rows.reduce((s, r) => s + r.than, 0)
                          return (
                            <div key={cat}>
                              <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                                {cat} · {catThan} than
                              </div>
                              <div className="text-xs divide-y divide-gray-100 dark:divide-gray-800">
                                {rows.map(r => (
                                  <label key={r.felId} className="flex items-center gap-3 px-3 py-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={picked.has(r.felId)}
                                      onChange={() => togglePick(r.felId)}
                                      className="accent-emerald-600"
                                    />
                                    <span className="font-mono text-gray-800 dark:text-gray-200 w-40 truncate" title={r.lotNo}>{r.lotNo}</span>
                                    <span className="text-gray-500 dark:text-gray-400 text-[11px]">{r.quality}</span>
                                    {r.shade && <span className="text-gray-500 dark:text-gray-400 text-[11px]">· {r.shade}</span>}
                                    <span className="ml-auto text-gray-700 dark:text-gray-300">{r.than} than</span>
                                  </label>
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
            ))}
          </div>
        </>
      )}

      {tab === 'issued' && (
        <div className="space-y-3">
          {issued && issued.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">Search</span>
                  <input
                    value={issuedQuery}
                    onChange={e => setIssuedQuery(e.target.value)}
                    placeholder="challan / party / lot / than"
                    className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1 placeholder-gray-400 dark:placeholder-gray-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">Party</span>
                  <select
                    value={issuedPartyFilter}
                    onChange={e => setIssuedPartyFilter(e.target.value)}
                    className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1"
                  >
                    <option value="all">All</option>
                    {issuedPartyOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">Sort by</span>
                  <select
                    value={issuedSort}
                    onChange={e => setIssuedSort(e.target.value as any)}
                    className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1"
                  >
                    <option value="challan_desc">Challan (newest)</option>
                    <option value="challan_asc">Challan (oldest)</option>
                    <option value="date_desc">Date (newest)</option>
                    <option value="party">Party</option>
                    <option value="than_desc">Total than (high → low)</option>
                  </select>
                </label>
                <div className="flex items-end justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{filteredIssued.length} of {issued.length} challans</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowTransport(v => !v)}
                      title="Show / hide the Transport column in the challan detail below"
                      className={`px-2.5 py-1.5 rounded font-semibold border whitespace-nowrap ${
                        showTransport
                          ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      {showTransport ? '✓ Transport shown' : 'Transport hidden'}
                    </button>
                    <button
                      onClick={() => setEdit(!editMode)}
                      title="Settings: enable editing issued challans — add missed than or remove wrongly-added lines"
                      className={`px-2.5 py-1.5 rounded font-semibold border whitespace-nowrap ${
                        editMode
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-400 dark:border-amber-700'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      {editMode ? '⚙ Edit mode: ON' : '⚙ Edit challans'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(!issued || issued.length === 0) && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              No challans issued yet.
            </div>
          )}

          {issued && issued.length > 0 && filteredIssued.length === 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              No challans match the current search / filters.
            </div>
          )}

          {filteredIssued.map(c => (
            <div key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">Challan {c.challanNo}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${c.status === 'issued' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>{c.status}</span>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {c.party.name} · {new Date(c.date).toLocaleDateString('en-IN')}
                  </div>
                  {(editMode || c.vehicleNo || c.destination) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="flex items-center gap-1">
                        <span className="text-gray-500 dark:text-gray-400">Vehicle No:</span>
                        {editMode ? (
                          <input defaultValue={c.vehicleNo ?? ''} onBlur={e => saveChallanField(c, 'vehicleNo', e.target.value)} placeholder="—"
                            className="w-28 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-1.5 py-0.5" />
                        ) : <span className="font-semibold text-gray-800 dark:text-gray-200">{c.vehicleNo || '—'}</span>}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-gray-500 dark:text-gray-400">Destination:</span>
                        {editMode ? (
                          <input defaultValue={c.destination ?? ''} onBlur={e => saveChallanField(c, 'destination', e.target.value)} placeholder="—"
                            className="w-32 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-1.5 py-0.5" />
                        ) : <span className="font-semibold text-gray-800 dark:text-gray-200">{c.destination || '—'}</span>}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">
                    {c.lines.reduce((s, l) => s + l.than, 0)}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">than · {c.lines.length} lots</div>
                </div>
              </div>
              <div className="px-4 py-2 overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="text-gray-500 dark:text-gray-400">
                    <tr className="text-left border-b border-gray-100 dark:border-gray-700">
                      <th className="py-1 pr-2 font-semibold">Lot No</th>
                      <th className="py-1 pr-2 font-semibold">Marka</th>
                      <th className="py-1 pr-2 font-semibold">Quality</th>
                      <th className="py-1 pr-2 font-semibold">Challan</th>
                      <th className="py-1 pr-2 font-semibold">Dye Slip</th>
                      {showTransport && <th className="py-1 pr-2 font-semibold">Transport / LR</th>}
                      <th className="py-1 pl-2 font-semibold text-right">Than</th>
                      {editMode && <th className="py-1 pl-2 w-8"></th>}
                    </tr>
                  </thead>
                  <tbody className="text-gray-700 dark:text-gray-300">
                    {c.lines.map(l => (
                      <tr key={l.id} className="border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                        <td className="py-1 pr-2 font-mono">{l.lotNo}</td>
                        <td className="py-1 pr-2 font-semibold">{l.marka ?? '-'}</td>
                        <td className="py-1 pr-2">{l.qualityName ?? '-'}</td>
                        <td className="py-1 pr-2 font-mono">{l.greyChallanNo ?? '-'}</td>
                        <td className="py-1 pr-2 font-mono text-indigo-600 dark:text-indigo-400">{l.dyeSlipNo ?? '-'}</td>
                        {showTransport && (() => {
                          const tName = l.transportName ?? c.transport
                          const tLr = l.transportLrNo ?? c.lrNo
                          return (
                            <td className="py-1 pr-2">
                              <span>{tName?.trim() || '-'}</span>
                              <span className="text-[10px] text-gray-400 ml-1 font-mono">LR {tLr?.trim() || (tName?.trim() ? 'Open' : '-')}</span>
                            </td>
                          )
                        })()}
                        <td className="py-1 pl-2 text-right">
                          {editMode ? (
                            <button onClick={() => editThan(c.id, l)} title="Click to edit than (reduce → frees to queue)" className="underline decoration-dotted underline-offset-2 hover:text-emerald-600 dark:hover:text-emerald-400 font-semibold">{l.than}</button>
                          ) : l.than}
                        </td>
                        {editMode && (
                          <td className="py-1 pl-2 text-right">
                            <button
                              onClick={() => removeLine(c.id, l)}
                              disabled={editBusy}
                              title="Remove this line (returns to queue)"
                              className="w-5 h-5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-200 disabled:opacity-50 leading-none"
                            >
                              ×
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {editMode && (() => {
                const avail = availByParty.get(c.party.id) ?? []
                const isOpen = addPanelFor === c.id
                return (
                  <div className="px-4 pb-2 -mt-1">
                    <button
                      onClick={() => { setAddPanelFor(isOpen ? null : c.id); setAddPick(new Set()) }}
                      className="text-xs px-2.5 py-1 rounded font-semibold border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                    >
                      {isOpen ? 'Close' : `+ Add lots${avail.length ? ` (${avail.length} in queue)` : ''}`}
                    </button>
                    {isOpen && (
                      <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-2">
                        {avail.length === 0 ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400 py-2 text-center">No queued finish-lots for {c.party.name}.</div>
                        ) : (
                          <>
                            <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                              {avail.map(r => (
                                <label key={r.felId} className="flex items-center gap-2 py-1 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={addPick.has(r.felId)}
                                    onChange={() => setAddPick(prev => { const n = new Set(prev); n.has(r.felId) ? n.delete(r.felId) : n.add(r.felId); return n })}
                                    className="accent-emerald-600"
                                  />
                                  <span className="font-mono text-gray-800 dark:text-gray-200">{r.lotNo}</span>
                                  <span className="text-gray-500 dark:text-gray-400">{r.quality}</span>
                                  {r.shade && <span className="text-gray-500 dark:text-gray-400">· {r.shade}</span>}
                                  <span className="text-[10px] text-gray-400">FP-{r.fpSlipNo}</span>
                                  <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-mono">Dye {r.dyeSlipNo ?? '?'}</span>
                                  <span className="ml-auto text-gray-700 dark:text-gray-300">{r.than} than</span>
                                </label>
                              ))}
                            </div>
                            <div className="flex items-center justify-end gap-2 mt-2">
                              <span className="text-[11px] text-gray-500 dark:text-gray-400 mr-auto">
                                {addPick.size} selected · {avail.filter(r => addPick.has(r.felId)).reduce((s, r) => s + r.than, 0)} than
                              </span>
                              <button
                                onClick={() => editLines(c.id, { addFelIds: [...addPick] })}
                                disabled={addPick.size === 0 || editBusy}
                                className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
                              >
                                {editBusy ? 'Adding…' : `Add ${addPick.size} to challan`}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}
              <div className="flex items-center justify-end gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-700">
                <button
                  onClick={() => toggleExtraCharges(c)}
                  title={c.showExtraCharges ? 'Extra charges (Freight + Checking) visible on print + PDF — click to hide' : 'Extra charges hidden on print + PDF — click to show'}
                  className={`text-xs px-2.5 py-1.5 rounded font-semibold border ${
                    c.showExtraCharges
                      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                  }`}
                >
                  {c.showExtraCharges ? '✓ Extras ON' : 'Extras OFF'}
                </button>
                <button
                  onClick={() => downloadDeliveryChallanPdf(c)}
                  className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold"
                >
                  PDF
                </button>
                <Link
                  href={`/delivery/${c.id}/print`}
                  target="_blank"
                  className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white font-semibold"
                >
                  Print
                </Link>
                {c.status === 'issued' && (
                  <button
                    onClick={() => cancelChallan(c)}
                    className="text-xs px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 dark:bg-rose-700 dark:hover:bg-rose-600 text-white font-semibold"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
