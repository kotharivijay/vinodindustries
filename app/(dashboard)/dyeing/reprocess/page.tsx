'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import BackButton from '../../BackButton'
import { LotLink, useLotBackHighlight, persistViewState, readViewState } from '@/lib/viewStatePersist'

const REPRO_VIEW_KEY = 'reprocess-view-state'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Source {
  id: number
  originalLotNo: string
  than: number
  party: string | null
  reason: string | null
  notes: string | null
  sourceDyeSlip: number | null
}

interface ReProLot {
  id: number
  reproNo: string
  quality: string
  weight: string | null
  grayMtr: number | null
  totalThan: number
  reason: string
  notes: string | null
  status: string
  mergedAt: string | null
  createdAt: string
  sources: Source[]
}

const REASONS = [
  { value: 'patchy', label: 'Patchy' },
  { value: 'daagi', label: 'Daagi' },
  { value: 'shade_mismatch', label: 'Shade Mismatch' },
  { value: 'other', label: 'Other' },
]

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  'in-dyeing': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  finished: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  merged: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
}

export default function ReProcessPage() {
  const { data: lots, mutate } = useSWR<ReProLot[]>('/api/dyeing/reprocess', fetcher)
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const arr = readViewState(REPRO_VIEW_KEY).expanded
    return new Set(Array.isArray(arr) ? arr : [])
  })

  useEffect(() => { persistViewState(REPRO_VIEW_KEY, { expanded: [...expanded] }) }, [expanded])
  useLotBackHighlight(REPRO_VIEW_KEY, true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Create form state
  const [reason, setReason] = useState('patchy')
  const [notes, setNotes] = useState('')
  const [sourceLots, setSourceLots] = useState<{ lotNo: string; than: string; reason: string }[]>([
    { lotNo: '', than: '', reason: 'patchy' },
  ])

  const toggle = (id: number) => {
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const addSourceRow = () => setSourceLots(prev => [...prev, { lotNo: '', than: '', reason }])
  const removeSourceRow = (i: number) => setSourceLots(prev => prev.filter((_, idx) => idx !== i))
  const updateSource = (i: number, field: string, val: string) => {
    setSourceLots(prev => { const u = [...prev]; u[i] = { ...u[i], [field]: val }; return u })
  }

  async function handleCreate() {
    const validSources = sourceLots.filter(s => s.lotNo.trim() && s.than.trim())
    if (validSources.length === 0) { setCreateError('Add at least one lot'); return }
    setCreating(true)
    setCreateError('')

    async function post(payload: any) {
      const res = await fetch('/api/dyeing/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      return { res, data }
    }

    try {
      const basePayload = {
        reason,
        notes: notes || null,
        sources: validSources.map(s => ({ lotNo: s.lotNo.trim(), than: parseInt(s.than), reason: s.reason })),
      }
      let extras: any = {}
      let { res, data } = await post(basePayload)

      // Step 1: mixed quality? Resolve into acceptMixedQuality / filtered sources.
      if (res.ok && data?.needsConfirm && data.reason === 'MIXED_QUALITY') {
        const lines = (data.lots || []).map((l: any) => `  ${l.lotNo}: ${l.quality ?? 'unknown'}`).join('\n')
        const choice = window.confirm(
          `Mixed qualities detected:\n\n${lines}\n\nClick OK to save with ALL lots (mixed quality).\nClick Cancel to drop the lots whose quality differs from the most common one and save the rest.`,
        )
        if (choice) {
          extras = { acceptMixedQuality: true }
        } else {
          const counts = new Map<string, number>()
          for (const l of data.lots || []) if (l.quality) counts.set(l.quality, (counts.get(l.quality) || 0) + 1)
          const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
          const keptLots = (data.lots || []).filter((l: any) => l.quality === winner).map((l: any) => l.lotNo.toLowerCase())
          const filteredSources = basePayload.sources.filter(s => keptLots.includes(s.lotNo.toLowerCase()))
          if (filteredSources.length === 0) { setCreateError('No lots left after excluding mismatched quality'); setCreating(false); return }
          basePayload.sources = filteredSources
          extras = { acceptMixedQuality: true }
        }
        ;({ res, data } = await post({ ...basePayload, ...extras }))
      }

      // Step 2: confirm weight + quality (always asked unless `confirmed: true`).
      if (res.ok && data?.needsConfirm && data.reason === 'CONFIRM_WEIGHT_QUALITY') {
        const computedQ = data.computedQuality
        const computedW = data.computedWeight
        const opts: string[] = data.qualityOptions || []
        let pickedQuality = computedQ
        if (!pickedQuality) {
          const list = opts.length ? `\n\nAvailable qualities:\n${opts.map((q, i) => `  ${i+1}. ${q}`).join('\n')}` : ''
          const ans = window.prompt(`No quality detected on source lots. Type a quality name to use:${list}`, opts[0] || '')
          if (!ans || !ans.trim()) { setCreateError('Quality required'); setCreating(false); return }
          pickedQuality = ans.trim()
        }
        const wAns = window.prompt(`Confirm/edit avg weight (computed: ${computedW ?? '—'}) and quality "${pickedQuality}".\n\nEnter weight (e.g. 110g, blank to skip):`, computedW ?? '')
        if (wAns === null) { setCreating(false); return } // user cancelled
        const qAns = window.prompt(`Quality:`, pickedQuality)
        if (qAns === null) { setCreating(false); return }
        ;({ res, data } = await post({ ...basePayload, ...extras, confirmed: true, confirmedWeight: wAns.trim(), confirmedQuality: qAns.trim() }))
      }

      if (!res.ok || data?.error) { setCreateError(data.error || 'Failed'); setCreating(false); return }
      setShowCreate(false)
      setSourceLots([{ lotNo: '', than: '', reason: 'patchy' }])
      setNotes('')
      mutate()
    } catch {
      setCreateError('Network error')
    }
    setCreating(false)
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this RE-PRO lot?')) return
    await fetch('/api/dyeing/reprocess', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    mutate()
  }

  async function handleStatusChange(id: number, status: string) {
    await fetch('/api/dyeing/reprocess', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    mutate()
  }

  // ── Edit RE-PRO ─────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editReason, setEditReason] = useState('patchy')
  const [editNotes, setEditNotes] = useState('')
  const [editGrayMtr, setEditGrayMtr] = useState('')
  const [editWeight, setEditWeight] = useState('')
  const [editSources, setEditSources] = useState<{ id: number; lotNo: string; than: string; party: string; notes: string }[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  function openEdit(lot: ReProLot) {
    setEditingId(lot.id)
    setEditReason(lot.reason)
    setEditNotes(lot.notes || '')
    setEditGrayMtr(lot.grayMtr != null ? String(lot.grayMtr) : '')
    setEditWeight(lot.weight || '')
    setEditSources(lot.sources.map(s => ({ id: s.id, lotNo: s.originalLotNo, than: String(s.than), party: s.party || '', notes: s.notes || '' })))
    setEditError('')
  }

  function closeEdit() { setEditingId(null); setEditWeight(''); setEditSources([]); setEditError('') }

  // Inline notes editing on the read-only card
  const [inlineNotesDraft, setInlineNotesDraft] = useState<Record<number, string>>({})
  const [inlineSavingId, setInlineSavingId] = useState<number | null>(null)
  async function saveSourceNotes(sourceId: number, lotId: number, value: string) {
    const before = (lots?.find(l => l.id === lotId)?.sources.find(s => s.id === sourceId)?.notes) ?? ''
    if (value === before) return
    setInlineSavingId(sourceId)
    try {
      await fetch('/api/dyeing/reprocess', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lotId, updateSources: [{ id: sourceId, notes: value }] }),
      })
      mutate()
    } finally { setInlineSavingId(null) }
  }

  async function saveEdit() {
    if (editingId == null) return
    setEditSaving(true); setEditError('')
    try {
      const original = lots?.find(l => l.id === editingId)
      const originalIds = new Set((original?.sources || []).map(s => s.id))
      const keptIds = new Set(editSources.map(s => s.id))
      const removeSources = [...originalIds].filter(id => !keptIds.has(id))
      const updateSources = editSources
        .filter(s => s.id > 0)
        .map(s => ({ id: s.id, originalLotNo: s.lotNo.trim(), than: parseInt(s.than) || 0, party: s.party || null, notes: s.notes || null }))

      const res = await fetch('/api/dyeing/reprocess', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, reason: editReason, notes: editNotes, grayMtr: editGrayMtr, weight: editWeight.trim() || null, updateSources, removeSources }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) { setEditError(data?.error || 'Save failed'); setEditSaving(false); return }
      closeEdit()
      mutate()
    } catch (e: any) { setEditError(e?.message || 'Network error') }
    setEditSaving(false)
  }

  const summary = useMemo(() => {
    if (!lots) return { total: 0, pending: 0, inDyeing: 0, finished: 0, merged: 0, totalThan: 0 }
    return {
      total: lots.length,
      pending: lots.filter(l => l.status === 'pending').length,
      inDyeing: lots.filter(l => l.status === 'in-dyeing').length,
      finished: lots.filter(l => l.status === 'finished').length,
      merged: lots.filter(l => l.status === 'merged').length,
      totalThan: lots.reduce((s, l) => s + l.totalThan, 0),
    }
  }, [lots])

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Re-Process Ledger</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {summary.total} lots · {summary.totalThan} · {summary.pending} pending · {summary.finished} finished
            </p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + New RE-PRO
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Pending', count: summary.pending, color: 'text-amber-600' },
          { label: 'In Dyeing', count: summary.inDyeing, color: 'text-blue-600' },
          { label: 'Finished', count: summary.finished, color: 'text-green-600' },
          { label: 'Merged', count: summary.merged, color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">{s.label}</p>
            <p className={`text-xl font-bold ${s.color} mt-0.5`}>{s.count}</p>
          </div>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-6 bg-black/40 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Create RE-PRO Lot</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">&times;</button>
            </div>
            <div className="p-5 space-y-4">
              {createError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm rounded-lg px-4 py-2">{createError}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reason</label>
                  <select value={reason} onChange={e => setReason(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                    {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                  <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Source Lots (same quality)</label>
                  <button onClick={addSourceRow} className="text-xs text-purple-600 dark:text-purple-400 font-medium">+ Add Lot</button>
                </div>
                <div className="space-y-2">
                  {sourceLots.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="text" value={s.lotNo} onChange={e => updateSource(i, 'lotNo', e.target.value)}
                        placeholder="Lot No" className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      <input type="number" value={s.than} onChange={e => updateSource(i, 'than', e.target.value)}
                        placeholder="Than" className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-center" />
                      <select value={s.reason} onChange={e => updateSource(i, 'reason', e.target.value)}
                        className="w-28 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-xs bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                        {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      {sourceLots.length > 1 && (
                        <button onClick={() => removeSourceRow(i)} className="text-red-400 hover:text-red-600 text-lg">&times;</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 font-medium">Cancel</button>
                <button onClick={handleCreate} disabled={creating}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                  {creating ? 'Creating...' : 'Create RE-PRO'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RE-PRO lot cards */}
      {!lots ? (
        <div className="p-12 text-center text-gray-400">Loading...</div>
      ) : lots.length === 0 ? (
        <div className="p-12 text-center text-gray-400">No re-process lots yet.</div>
      ) : (
        <div className="space-y-3">
          {lots.map(lot => {
            const isOpen = expanded.has(lot.id)
            return (
              <div key={lot.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <button onClick={() => toggle(lot.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                  <div className="text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-purple-700 dark:text-purple-400">{lot.reproNo}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[lot.status] || 'bg-gray-100 text-gray-600'}`}>{lot.status}</span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">{lot.reason}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {lot.quality} · {lot.sources.length} lot{lot.sources.length !== 1 ? 's' : ''} · {new Date(lot.createdAt).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{lot.totalThan}</span>
                    <span className={`text-gray-400 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  </div>
                </button>

                {isOpen && editingId === lot.id && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-4 pb-4 pt-3 space-y-3 bg-amber-50/40 dark:bg-amber-900/10">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase">Editing RE-PRO {lot.reproNo}</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-1">Reason</label>
                        <select value={editReason} onChange={e => setEditReason(e.target.value)}
                          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                          {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-1">Weight</label>
                        <input type="text" value={editWeight} onChange={e => setEditWeight(e.target.value)}
                          placeholder="e.g. 110g"
                          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-1">Total Meter</label>
                        <input type="number" step="0.01" value={editGrayMtr} onChange={e => setEditGrayMtr(e.target.value)}
                          placeholder="metres"
                          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-1">Notes</label>
                        <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase">Source lots</p>
                      {editSources.map((s, idx) => (
                        <div key={s.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 space-y-1">
                          <div className="flex items-center gap-2">
                            <input type="text" value={s.lotNo} onChange={e => setEditSources(prev => prev.map((x, i) => i === idx ? { ...x, lotNo: e.target.value } : x))}
                              className="w-24 text-xs font-medium text-teal-700 dark:text-teal-400 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700" placeholder="lot no" />
                            <input type="number" value={s.than} onChange={e => setEditSources(prev => prev.map((x, i) => i === idx ? { ...x, than: e.target.value } : x))}
                              className="w-16 text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-100 text-center" placeholder="than" />
                            <input type="text" value={s.party} onChange={e => setEditSources(prev => prev.map((x, i) => i === idx ? { ...x, party: e.target.value } : x))}
                              className="flex-1 text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 dark:text-gray-100" placeholder="party" />
                            <button onClick={() => setEditSources(prev => prev.filter((_, i) => i !== idx))}
                              className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
                          </div>
                          <input type="text" value={s.notes} onChange={e => setEditSources(prev => prev.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))}
                            className="w-full text-[11px] border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300" placeholder="notes for this lot" />
                        </div>
                      ))}
                    </div>
                    {editError && <p className="text-xs text-red-600 dark:text-red-400">{editError}</p>}
                    <div className="flex items-center gap-2">
                      <button onClick={saveEdit} disabled={editSaving}
                        className="text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-3 py-1.5 rounded font-semibold">
                        {editSaving ? 'Saving…' : 'Save Changes'}
                      </button>
                      <button onClick={closeEdit} disabled={editSaving} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400">Cancel</button>
                    </div>
                  </div>
                )}
                {isOpen && editingId !== lot.id && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-4 pb-4 pt-3 space-y-3">
                    {/* Source lots */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Source Lots</p>
                      {lot.sources.map(s => {
                        const draftKey = s.id
                        const draftVal = inlineNotesDraft[draftKey] ?? (s.notes || '')
                        return (
                        <div key={s.id} data-lot-card={s.originalLotNo} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 text-xs transition-shadow">
                          <div className="flex items-center justify-between">
                            <div>
                              <LotLink lotNo={s.originalLotNo} storageKey={REPRO_VIEW_KEY} className="font-medium text-teal-700 dark:text-teal-400 hover:underline">{s.originalLotNo}</LotLink>
                              {s.party && <span className="text-gray-500 dark:text-gray-400 ml-2">{s.party}</span>}
                              {s.reason && <span className="text-gray-400 ml-2">({s.reason})</span>}
                              {s.sourceDyeSlip && <span className="text-gray-400 ml-1">Slip {s.sourceDyeSlip}</span>}
                            </div>
                            <span className="font-bold text-gray-700 dark:text-gray-200">{s.than}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <input
                              type="text"
                              value={draftVal}
                              placeholder="add note for this lot…"
                              onChange={e => setInlineNotesDraft(prev => ({ ...prev, [draftKey]: e.target.value }))}
                              onBlur={e => saveSourceNotes(s.id, lot.id, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              className="flex-1 text-[11px] italic bg-transparent border-0 border-b border-dashed border-gray-300 dark:border-gray-600 focus:outline-none focus:border-purple-500 px-0 py-0.5 text-gray-600 dark:text-gray-300"
                            />
                            {inlineSavingId === s.id && <span className="text-[9px] text-gray-400">saving…</span>}
                          </div>
                        </div>
                        )
                      })}
                    </div>

                    {/* Info */}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
                      {lot.weight && <span>Weight: {lot.weight}</span>}
                      {lot.grayMtr && <span>Meter: {lot.grayMtr.toFixed(0)}m</span>}
                      {lot.notes && <span>Notes: {lot.notes}</span>}
                      {lot.mergedAt && <span>Merged: {new Date(lot.mergedAt).toLocaleDateString('en-IN')}</span>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      {lot.status === 'pending' && (
                        <>
                          <button onClick={() => openEdit(lot)}
                            className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-3 py-1 rounded-lg font-medium">
                            Edit
                          </button>
                          <button onClick={() => handleDelete(lot.id)}
                            className="text-xs text-red-400 hover:text-red-600 ml-auto">Delete</button>
                        </>
                      )}
                      {lot.status === 'finished' && (
                        <button onClick={() => handleStatusChange(lot.id, 'merged')}
                          className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 px-3 py-1 rounded-lg font-medium">
                          Merge Back to Original
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
