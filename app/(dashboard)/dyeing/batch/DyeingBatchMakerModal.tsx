'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'

// Matches the shape returned by /api/dyeing/batches (extended with batchMakingSlip)
interface LotInfo {
  lotNo: string
  than: number
  weightPerThan: number
  quality?: string
  marka?: string | null
}

interface BatchInfo {
  foldNo: string
  foldDate: string
  foldProgramId: number
  batchNo: number
  batchId: number
  shadeName: string
  shadeDescription?: string | null
  marka?: string | null
  lots: LotInfo[]
  totalThan: number
  totalWeight: number
  isPcJob?: boolean
  batchMakingSlip?: { slipNo: string; batchMakerName: string; date: string } | null
}

interface BatchMaker { id: number; name: string }

// Lightweight shape returned by GET /api/dyeing/batch-maker for the list view
interface SavedSlipListItem {
  id: number
  slipNo: string
  serialNo: number
  date: string
  batchMakerName: string
  status: string  // 'confirmed' | 'cancelled'
  batches: { batchNoSnapshot: number; foldNoSnapshot: string }[]
  _count?: { batches: number }
}

interface SavedSlip {
  id: number
  slipNo: string
  date: string
  batchMakerName: string
  batches: {
    foldNoSnapshot: string
    batchNoSnapshot: number
    shadeNameSnapshot: string | null
    markaSnapshot: string | null
    totalThanSnapshot: number
    totalWeightSnapshot: number | string
    jetNo: number | null
    jetSerial: number | null
    foldBatch: {
      lots: { lotNo: string; than: number; marka?: string | null }[]
      // Live fields on the FoldBatch row — may have been edited after the
      // BM slip was printed, so they shadow the snapshots in the detail
      // view per the same priority Dyeing pages follow.
      shadeName: string | null
      shadeDescription: string | null
      marka: string | null
      shade: { name: string; description: string | null } | null
      // Newest first. The latest entry's overrides win over FoldBatch /
      // Shade master, matching DyeingEntry.shadeDescription's documented
      // read order. Empty list = no dyeing slip cut yet for this batch.
      dyeingEntries: {
        id: number
        slipNo: number
        date: string
        status: string
        shadeName: string | null
        shadeDescription: string | null
        marka: string | null
      }[]
    }
  }[]
}

// Resolve the values the saved-slip detail view should display for one
// batch row. Read priority: latest DyeingEntry → live FoldBatch fields →
// Shade master → the BM-print snapshot. The snapshot is the final
// fallback so the row never blanks out even if the fold/dyeing rows are
// somehow missing the field.
function currentValues(b: SavedSlip['batches'][number]) {
  // POST response only includes foldBatch.lots; the richer GET shape adds
  // shade, foldProgram, dyeingEntries. Optional-chain everything so the
  // post-save panel can render against either response without crashing.
  const fb: any = (b as any).foldBatch ?? {}
  const latest = fb.dyeingEntries?.[0]
  return {
    shadeName:
      latest?.shadeName ||
      fb.shadeName ||
      fb.shade?.name ||
      b.shadeNameSnapshot ||
      null,
    shadeDescription:
      latest?.shadeDescription ||
      fb.shadeDescription ||
      fb.shade?.description ||
      null,
    marka:
      latest?.marka ||
      fb.marka ||
      b.markaSnapshot ||
      null,
    slipNo: latest?.slipNo ?? null,
    slipStatus: latest?.status ?? null,
  }
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function useDebounce(initial = '', delay = 200) {
  const [debounced, setDebounced] = useState(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(v), delay)
  }
  return [debounced, set] as const
}

export default function DyeingBatchMakerModal({ onClose, onSaved }: {
  onClose: () => void
  onSaved: () => void
}) {
  const { data: allBatches = [], mutate: mutateBatches } = useSWR<BatchInfo[]>('/api/dyeing/batches', fetcher, { revalidateOnFocus: false })
  const { data: makers = [], mutate: mutateMakers } = useSWR<BatchMaker[]>('/api/batch-makers', fetcher, { revalidateOnFocus: false })
  const { data: nextSlip } = useSWR<{ next: string }>('/api/dyeing/batch-maker/next-slip-no', fetcher, { revalidateOnFocus: false })
  const { data: savedSlips = [], mutate: mutateSavedSlips } = useSWR<SavedSlipListItem[]>('/api/dyeing/batch-maker', fetcher, { revalidateOnFocus: false })

  // Inner tab: 'new' is the picker, 'saved' is the cancel/audit view. Default
  // is 'new' so opening the popup always lands Shanker on the create flow.
  const [innerTab, setInnerTab] = useState<'new' | 'saved'>('new')

  const [date, setDate] = useState(todayISO())
  const [batchMakerName, setBatchMakerName] = useState('Shanker')
  const [notes, setNotes] = useState('')
  const [batchSearch, setBatchSearch] = useState('')
  const [debSearch, setDebSearch] = useDebounce()

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedSlip, setSavedSlip] = useState<SavedSlip | null>(null)
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState('')
  const [cancellingId, setCancellingId] = useState<number | null>(null)
  const [viewingId, setViewingId] = useState<number | null>(null)

  // Jet planning state. tagMode toggles per-batch jet dropdowns; tags maps
  // batchId → {jetNo, jetSerial}. Null entries are fine — POST stores nulls
  // and the print template falls back to fold grouping when no jets are set.
  const [tagMode, setTagMode] = useState(false)
  const [tags, setTags] = useState<Map<number, { jetNo: number | null; jetSerial: number | null }>>(new Map())

  // Preview/draft state. previewMode swaps the picker for a read-only summary
  // grouped by jet. draftSaving guards the Save Draft button. draftLoaded is
  // only true after the first GET completes so the modal doesn't flash an
  // empty selection before hydration.
  const [previewMode, setPreviewMode] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [draftRestoredMsg, setDraftRestoredMsg] = useState('')

  // Draft hydration on mount: load any saved selection + tags + form values
  // from the server. Runs once per modal open; the draft is cleared by the
  // server when a real BM slip is saved.
  useEffect(() => {
    let cancelled = false
    fetch('/api/dyeing/batch-maker/draft')
      .then(r => r.json())
      .then((draft: any) => {
        if (cancelled || !draft) { setDraftLoaded(true); return }
        if (draft.date) setDate(String(draft.date).slice(0, 10))
        if (draft.batchMakerName) setBatchMakerName(draft.batchMakerName)
        if (draft.notes) setNotes(draft.notes)
        if (typeof draft.tagMode === 'boolean') setTagMode(draft.tagMode)
        if (Array.isArray(draft.data)) {
          const nextSel = new Set<number>()
          const nextTags = new Map<number, { jetNo: number | null; jetSerial: number | null }>()
          for (const b of draft.data) {
            const id = Number(b?.batchId)
            if (!Number.isFinite(id)) continue
            nextSel.add(id)
            nextTags.set(id, {
              jetNo: b?.jetNo == null ? null : Number(b.jetNo),
              jetSerial: b?.jetSerial == null ? null : Number(b.jetSerial),
            })
          }
          setSelected(nextSel)
          setTags(nextTags)
          if (nextSel.size > 0) {
            setDraftRestoredMsg(`Restored draft — ${nextSel.size} batch${nextSel.size === 1 ? '' : 'es'}`)
            setTimeout(() => setDraftRestoredMsg(''), 4000)
          }
        }
        setDraftLoaded(true)
      })
      .catch(() => setDraftLoaded(true))
    return () => { cancelled = true }
  }, [])

  // Group selected batches by jet for the preview panel. Untagged batches
  // collect under an 'Untagged' bucket so the operator can see what still
  // needs a jet (save remains allowed — that's the chosen policy).
  const previewGroups = useMemo(() => {
    const sel = allBatches.filter(b => selected.has(b.batchId))
    const buckets = new Map<number | null, typeof sel>()
    for (const b of sel) {
      const t = tags.get(b.batchId)
      const jet = tagMode ? (t?.jetNo ?? null) : null
      if (!buckets.has(jet)) buckets.set(jet, [])
      buckets.get(jet)!.push(b)
    }
    const groups = Array.from(buckets.entries())
      .map(([jetNo, batches]) => ({
        jetNo,
        batches: batches.slice().sort((a, b) => {
          const sa = tags.get(a.batchId)?.jetSerial ?? 999
          const sb = tags.get(b.batchId)?.jetSerial ?? 999
          return sa - sb
        }),
      }))
      .sort((a, b) => {
        if (a.jetNo == null) return 1
        if (b.jetNo == null) return -1
        return a.jetNo - b.jetNo
      })
    return groups
  }, [allBatches, selected, tags, tagMode])

  function setBatchTag(batchId: number, patch: { jetNo?: number | null; jetSerial?: number | null }) {
    setTags(prev => {
      const next = new Map(prev)
      const cur = next.get(batchId) ?? { jetNo: null, jetSerial: null }
      next.set(batchId, { ...cur, ...patch })
      return next
    })
  }

  // Only show batches that need a BM slip: not cancelled, not already on
  // an active BM slip (server filters slipStatus='confirmed' on its side).
  const pending = useMemo(() => {
    return allBatches.filter(b => !b.batchMakingSlip)
  }, [allBatches])

  // Group by fold for the collapsible header
  const grouped = useMemo(() => {
    const map = new Map<string, BatchInfo[]>()
    for (const b of pending) {
      if (!map.has(b.foldNo)) map.set(b.foldNo, [])
      map.get(b.foldNo)!.push(b)
    }
    return Array.from(map.entries())
      .map(([foldNo, batches]) => ({
        foldNo,
        foldDate: batches[0]?.foldDate,
        batches: batches.sort((a, b) => a.batchNo - b.batchNo),
      }))
      .sort((a, b) => new Date(b.foldDate || 0).getTime() - new Date(a.foldDate || 0).getTime())
  }, [pending])

  const filtered = useMemo(() => {
    const q = debSearch.toLowerCase().trim()
    if (!q) return grouped
    return grouped
      .map(g => ({
        ...g,
        batches: g.batches.filter(b => {
          if (g.foldNo.toLowerCase().includes(q)) return true
          if (String(b.batchNo).includes(q)) return true
          if (b.shadeName?.toLowerCase().includes(q)) return true
          if (b.marka?.toLowerCase().includes(q)) return true
          if (b.lots.some(l => l.lotNo.toLowerCase().includes(q))) return true
          return false
        }),
      }))
      .filter(g => g.batches.length > 0)
  }, [grouped, debSearch])

  const selectedBatches = useMemo(
    () => pending.filter(b => selected.has(b.batchId)),
    [pending, selected]
  )
  const totalThan = selectedBatches.reduce((s, b) => s + b.totalThan, 0)
  const totalWeight = selectedBatches.reduce((s, b) => s + b.totalWeight, 0)

  function toggleBatch(batchId: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
  }

  async function handleViewSlip(slipId: number) {
    setViewingId(slipId)
    try {
      const res = await fetch(`/api/dyeing/batch-maker/${slipId}`)
      const data = await res.json()
      if (!res.ok) {
        alert(data?.error ?? 'Failed to load slip')
        return
      }
      // Reuse the post-save print panel — it already renders batches,
      // lots, jet/serial badges, and exposes Print + WhatsApp buttons.
      setSavedSlip(data)
    } catch (e: any) {
      alert(e?.message ?? 'Network error')
    } finally {
      setViewingId(null)
    }
  }

  async function handleCancelSlip(slip: SavedSlipListItem) {
    const ok = window.confirm(
      `Cancel ${slip.slipNo} (${slip.batchMakerName})?\n\n` +
      `${slip.batches.length} batch${slip.batches.length === 1 ? '' : 'es'} will re-open for a fresh BM slip.\n` +
      `The serial ${slip.slipNo} stays in the audit trail.`
    )
    if (!ok) return
    setCancellingId(slip.id)
    try {
      const res = await fetch(`/api/dyeing/batch-maker/${slip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data?.error ?? 'Cancel failed')
        return
      }
      // Refetch both lists so the cancelled slip shows greyed out AND the
      // freed batches re-appear under the New tab + on the page's Step-1
      // picker (via the onSaved bubble).
      await Promise.all([mutateSavedSlips(), mutateBatches()])
      onSaved()
    } catch (e: any) {
      alert(e?.message ?? 'Network error')
    } finally {
      setCancellingId(null)
    }
  }

  async function handleAddMaker() {
    const name = prompt('New batch maker name')?.trim()
    if (!name) return
    const res = await fetch('/api/batch-makers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { alert('Failed to add batch maker'); return }
    await mutateMakers()
    setBatchMakerName(name)
  }

  async function handleSaveDraft() {
    setError('')
    if (selected.size === 0) { setError('Pick at least one batch to save a draft'); return }
    if (!batchMakerName.trim()) { setError('Batch maker name required'); return }
    setDraftSaving(true)
    try {
      const payload = {
        date,
        batchMakerName: batchMakerName.trim(),
        notes: notes.trim() || null,
        tagMode,
        batches: selectedBatches.map(b => {
          const t = tags.get(b.batchId)
          return {
            batchId: b.batchId,
            jetNo: tagMode ? (t?.jetNo ?? null) : null,
            jetSerial: tagMode ? (t?.jetSerial ?? null) : null,
          }
        }),
      }
      const res = await fetch('/api/dyeing/batch-maker/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Failed to save draft')
        return
      }
      setPreviewMode(true)
    } catch (e: any) {
      setError(e?.message ?? 'Network error')
    } finally {
      setDraftSaving(false)
    }
  }

  async function handleSave() {
    setError('')
    if (selected.size === 0) { setError('Pick at least one batch'); return }
    if (!batchMakerName.trim()) { setError('Batch maker name required'); return }
    setSaving(true)
    try {
      const payload = {
        date,
        batchMakerName: batchMakerName.trim(),
        notes: notes.trim() || null,
        batches: selectedBatches.map(b => {
          const t = tags.get(b.batchId)
          return {
            foldBatchId: b.batchId,
            foldNo: b.foldNo,
            batchNo: b.batchNo,
            shadeName: b.shadeName,
            marka: b.marka ?? null,
            totalThan: b.totalThan,
            totalWeight: b.totalWeight,
            jetNo: tagMode ? (t?.jetNo ?? null) : null,
            jetSerial: tagMode ? (t?.jetSerial ?? null) : null,
          }
        }),
      }
      const res = await fetch('/api/dyeing/batch-maker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Failed to save')
        setSaving(false)
        return
      }
      setSavedSlip(data)
    } catch (e: any) {
      setError(e?.message ?? 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handlePrint() {
    if (!savedSlip) return
    setPrintError('')
    setPrinting(true)
    try {
      const { buildBatchMakerReceipt, printBatchMakerSlip } = await import('./batchMakerPrint')
      await printBatchMakerSlip(savedSlip, buildBatchMakerReceipt)
    } catch (e: any) {
      setPrintError(e?.message ?? 'Print failed')
    } finally {
      setPrinting(false)
    }
  }

  // Share the same text receipt the Bluetooth printer would emit so what
  // Shanker reads on his phone matches the physical slip exactly.
  const [sharing, setSharing] = useState(false)
  async function handleShare() {
    if (!savedSlip) return
    setPrintError('')
    setSharing(true)
    try {
      const { buildBatchMakerReceipt } = await import('./batchMakerPrint')
      const text = buildBatchMakerReceipt(savedSlip)
      const title = `KSI Batch Making — ${savedSlip.slipNo}`
      // Prefer the native share sheet on mobile (lets the user pick WhatsApp,
      // a specific contact, etc.). Fall back to wa.me on desktop.
      if (navigator.share) {
        try {
          await navigator.share({ title, text })
          return
        } catch (e: any) {
          if (e?.name === 'AbortError') return  // user dismissed sheet
        }
      }
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    } catch (e: any) {
      setPrintError(e?.message ?? 'Share failed')
    } finally {
      setSharing(false)
    }
  }

  function handleClose() {
    if (savedSlip) onSaved()
    onClose()
  }

  // After save the modal flips into a print-and-close panel; before save it
  // shows the batch picker. Two panels in one component keeps the flow
  // single-page so the operator never loses context.
  const showPicker = !savedSlip

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-lg bg-slate-900 border border-slate-700 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {!showPicker
                ? `Saved: ${savedSlip!.slipNo}`
                : previewMode
                  ? 'Preview — Batch Making Slip'
                  : 'Batch Maker Slip'}
            </h2>
            <p className="text-xs text-slate-400">
              {!showPicker
                ? 'Connect a Bluetooth thermal printer and tap Print to give Shanker the slip.'
                : previewMode
                  ? 'Review batches by jet/serial. Edit to change, or Save & Print to commit.'
                  : 'Pick the fold batches you are physically assembling — one slip, one serial.'}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white text-xl leading-none px-2"
          >
            ✕
          </button>
        </div>

        {showPicker && !previewMode && (
          <div className="flex gap-1 bg-slate-800 mx-5 mt-3 rounded p-1">
            <button
              onClick={() => setInnerTab('new')}
              className={`flex-1 text-xs font-medium rounded py-1.5 transition ${
                innerTab === 'new' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              + New Slip
            </button>
            <button
              onClick={() => setInnerTab('saved')}
              className={`flex-1 text-xs font-medium rounded py-1.5 transition ${
                innerTab === 'saved' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Saved BM Slips ({savedSlips.length})
            </button>
          </div>
        )}

        {showPicker && previewMode ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Draft saved. This is what the slip will print —
                batches grouped by jet, in serial order.{' '}
                {tagMode ? '' : 'Turn Tag Mode ON in the picker to assign jets.'}
              </div>
              {previewGroups.map((g, gi) => (
                <div key={gi} className="rounded border border-slate-700 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-800/60 text-sm text-white flex items-center justify-between">
                    <div>
                      {g.jetNo == null ? (
                        <span className="text-slate-300">Untagged</span>
                      ) : (
                        <span className="font-semibold text-amber-300">Jet-{g.jetNo}</span>
                      )}
                      <span className="ml-2 text-xs text-slate-400">
                        {g.batches.length} batch{g.batches.length === 1 ? '' : 'es'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {g.batches.reduce((s, b) => s + b.totalThan, 0)} than
                      {' · '}
                      {g.batches.reduce((s, b) => s + b.totalWeight, 0).toFixed(1)} kg
                    </div>
                  </div>
                  <div className="divide-y divide-slate-800">
                    {g.batches.map(b => {
                      const t = tags.get(b.batchId)
                      const serial = t?.jetSerial
                      return (
                        <div key={b.batchId} className="px-3 py-2 text-sm">
                          <div className="flex items-baseline justify-between gap-2">
                            <div>
                              {serial != null && (
                                <span className="font-mono text-amber-300 mr-2">
                                  {ordinal(serial)}
                                </span>
                              )}
                              <span className="text-white">B{b.batchNo}</span>
                              <span className="ml-2 text-slate-400 text-xs">Fold {b.foldNo}</span>
                              <span className="ml-2 text-slate-300 text-xs">{b.shadeName}</span>
                              {b.marka && <span className="ml-2 text-amber-400 text-xs">Marka: {b.marka}</span>}
                            </div>
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                              {b.totalThan} than · {b.totalWeight.toFixed(1)} kg
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {b.lots.map((l, li) => (
                              <span key={li} className="inline-flex items-center rounded bg-slate-800 text-purple-300 text-xs px-2 py-0.5">
                                {l.lotNo} ({l.than})
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {error && (
                <div className="rounded bg-red-500/10 border border-red-500/40 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>
            <div className="border-t border-slate-700 px-5 py-3 flex items-center justify-between gap-3 bg-slate-900">
              <div className="text-sm text-slate-300">
                <span className="font-semibold text-white">{selected.size}</span> batch{selected.size === 1 ? '' : 'es'}
                <span className="text-slate-500"> · </span>
                {totalThan} than
                <span className="text-slate-500"> · </span>
                {totalWeight.toFixed(1)} kg
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPreviewMode(false)}
                  className="px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white"
                >
                  ← Edit
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || selected.size === 0}
                  className="px-4 py-1.5 rounded text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white"
                >
                  {saving ? 'Saving…' : 'Save & Activate Print'}
                </button>
              </div>
            </div>
          </>
        ) : showPicker && innerTab === 'saved' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            {savedSlips.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-10">
                No BM slips yet.
              </div>
            ) : (
              savedSlips.map(s => {
                const cancelled = s.status === 'cancelled'
                return (
                  <div
                    key={s.id}
                    className={`rounded border px-3 py-2 ${cancelled ? 'border-slate-800 bg-slate-900/50 opacity-60' : 'border-slate-700 bg-slate-800/40'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm">
                          <span className={`font-mono font-semibold ${cancelled ? 'line-through text-slate-400' : 'text-purple-300'}`}>
                            {s.slipNo}
                          </span>
                          <span className="ml-2 text-slate-300">{s.batchMakerName}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            {new Date(s.date).toLocaleDateString('en-IN')}
                          </span>
                          {cancelled && (
                            <span className="ml-2 text-[10px] uppercase font-semibold bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded">
                              Cancelled
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-400 truncate">
                          {s.batches.length} batch{s.batches.length === 1 ? '' : 'es'}:{' '}
                          {s.batches.map(b => `Fold ${b.foldNoSnapshot}·B${b.batchNoSnapshot}`).join(', ')}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        <button
                          onClick={() => handleViewSlip(s.id)}
                          disabled={viewingId === s.id}
                          className="text-xs bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 text-white px-3 py-1.5 rounded"
                        >
                          {viewingId === s.id ? 'Loading…' : 'View'}
                        </button>
                        {!cancelled && (
                          <button
                            onClick={() => handleCancelSlip(s)}
                            disabled={cancellingId === s.id}
                            className="text-xs bg-red-600/80 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-3 py-1.5 rounded"
                          >
                            {cancellingId === s.id ? 'Cancelling…' : 'Cancel'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        ) : showPicker ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Batch Maker</label>
                  <select
                    value={batchMakerName}
                    onChange={e => {
                      if (e.target.value === '__add__') { handleAddMaker(); return }
                      setBatchMakerName(e.target.value)
                    }}
                    className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white"
                  >
                    {makers.length === 0 && <option value="Shanker">Shanker</option>}
                    {makers.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                    <option value="__add__">+ Add new…</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Next Slip No</label>
                  <div className="rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-purple-300 font-mono">
                    {nextSlip?.next ?? 'BM-…'}
                  </div>
                </div>
              </div>

              {draftRestoredMsg && (
                <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  {draftRestoredMsg}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search fold no, batch no, shade, marka, lot…"
                    value={batchSearch}
                    onChange={e => { setBatchSearch(e.target.value); setDebSearch(e.target.value) }}
                    className="w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setTagMode(v => !v)}
                  className={`shrink-0 text-xs font-medium px-3 py-2 rounded transition ${
                    tagMode
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                  }`}
                  title="Toggle jet/serial tagging on each selected batch"
                >
                  🏷 Tag Mode: {tagMode ? 'ON' : 'OFF'}
                </button>
              </div>

              {filtered.length === 0 ? (
                <div className="text-center text-slate-400 text-sm py-10">
                  No pending batches. Either everything is already on a BM slip, or no fold programs are confirmed yet.
                </div>
              ) : (
                filtered.map(g => (
                  <div key={g.foldNo} className="rounded border border-slate-700">
                    <div className="bg-slate-800/60 px-3 py-2 text-sm text-slate-200 flex items-center justify-between">
                      <span>
                        <strong className="text-white">Fold {g.foldNo}</strong>
                        <span className="ml-2 text-xs text-slate-400">
                          {g.foldDate ? new Date(g.foldDate).toLocaleDateString('en-IN') : ''}
                        </span>
                        <span className="ml-2 inline-block rounded bg-purple-500/20 text-purple-300 text-xs px-2 py-0.5">
                          {g.batches.length} pending
                        </span>
                      </span>
                    </div>
                    <div className="divide-y divide-slate-800">
                      {g.batches.map(b => {
                        const checked = selected.has(b.batchId)
                        return (
                          <label
                            key={b.batchId}
                            className={`flex items-start gap-3 px-3 py-3 cursor-pointer hover:bg-slate-800/40 ${checked ? 'bg-purple-500/10' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleBatch(b.batchId)}
                              className="mt-1 h-4 w-4 accent-purple-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <div>
                                  <span className="text-white font-medium">B{b.batchNo}</span>
                                  <span className="ml-2 text-sm text-slate-300">{b.shadeName}</span>
                                  {b.shadeDescription && (
                                    <span className="ml-1 text-xs text-slate-500">{b.shadeDescription}</span>
                                  )}
                                  {b.marka && (
                                    <span className="ml-2 text-xs text-amber-400">Marka: {b.marka}</span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400 whitespace-nowrap">
                                  {b.totalThan} than · {b.totalWeight.toFixed(1)} kg
                                </div>
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {b.lots.map((l, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center rounded bg-slate-800 text-purple-300 text-xs px-2 py-0.5"
                                  >
                                    {l.lotNo} ({l.than})
                                  </span>
                                ))}
                              </div>
                              {tagMode && checked && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className="text-[10px] uppercase font-semibold text-amber-300">Jet</span>
                                  <select
                                    value={tags.get(b.batchId)?.jetNo ?? ''}
                                    onChange={e => setBatchTag(b.batchId, { jetNo: e.target.value ? Number(e.target.value) : null })}
                                    onClick={ev => ev.stopPropagation()}
                                    className="rounded bg-slate-800 border border-amber-500/40 text-xs text-amber-200 px-1.5 py-0.5"
                                  >
                                    <option value="">—</option>
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                                      <option key={n} value={n}>Jet-{n}</option>
                                    ))}
                                  </select>
                                  <span className="text-[10px] uppercase font-semibold text-amber-300">Serial</span>
                                  <select
                                    value={tags.get(b.batchId)?.jetSerial ?? ''}
                                    onChange={e => setBatchTag(b.batchId, { jetSerial: e.target.value ? Number(e.target.value) : null })}
                                    onClick={ev => ev.stopPropagation()}
                                    className="rounded bg-slate-800 border border-amber-500/40 text-xs text-amber-200 px-1.5 py-0.5"
                                  >
                                    <option value="">—</option>
                                    {[1, 2, 3, 4, 5, 6].map(n => (
                                      <option key={n} value={n}>{ordinal(n)}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-white"
                />
              </div>

              {error && (
                <div className="rounded bg-red-500/10 border border-red-500/40 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-slate-700 px-5 py-3 flex items-center justify-between gap-3 bg-slate-900">
              <div className="text-sm text-slate-300">
                <span className="font-semibold text-white">{selected.size}</span> batch{selected.size === 1 ? '' : 'es'}
                <span className="text-slate-500"> · </span>
                {totalThan} than
                <span className="text-slate-500"> · </span>
                {totalWeight.toFixed(1)} kg
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDraft}
                  disabled={draftSaving || selected.size === 0}
                  className="px-3 py-1.5 rounded text-sm bg-amber-600/80 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white"
                  title="Save current selection + jet tags as a draft so you can resume after closing"
                >
                  {draftSaving ? 'Saving Draft…' : '👁 Save Draft & Preview'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || selected.size === 0}
                  className="px-4 py-1.5 rounded text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white"
                >
                  {saving ? 'Saving…' : 'Save & Activate Print'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="rounded border border-green-500/40 bg-green-500/10 px-4 py-3">
                <div className="text-sm text-green-300 font-semibold">
                  {savedSlip!.slipNo}
                  {(savedSlip as any).status === 'cancelled' && (
                    <span className="ml-2 text-[10px] uppercase font-semibold bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded">
                      Cancelled
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-300 mt-1">
                  {savedSlip!.batchMakerName} · {new Date(savedSlip!.date).toLocaleDateString('en-IN')}
                </div>
              </div>
              <div className="rounded border border-slate-700 divide-y divide-slate-800">
                {savedSlip!.batches.map((b, i) => {
                  const cv = currentValues(b)
                  return (
                    <div key={i} className="px-3 py-2 text-sm">
                      <div className="text-white flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        {b.jetNo != null && (
                          <span className="text-[10px] font-mono uppercase bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                            Jet-{b.jetNo}{b.jetSerial != null ? ` · ${ordinal(b.jetSerial)}` : ''}
                          </span>
                        )}
                        <span>Fold {b.foldNoSnapshot} · B{b.batchNoSnapshot}</span>
                        {cv.shadeName && <span className="text-slate-300">{cv.shadeName}</span>}
                        {cv.slipNo != null && (
                          <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">
                            Slip {cv.slipNo}
                            {cv.slipStatus && cv.slipStatus !== 'pending' && ` · ${cv.slipStatus}`}
                          </span>
                        )}
                      </div>
                      {cv.shadeDescription && (
                        <div className="text-xs text-slate-400 mt-0.5">{cv.shadeDescription}</div>
                      )}
                      {cv.marka && (
                        <div className="text-xs text-amber-400">Marka: {cv.marka}</div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {b.foldBatch.lots.map((l, j) => (
                          <span
                            key={j}
                            className="inline-flex items-center rounded bg-slate-800 text-purple-300 text-xs px-2 py-0.5"
                          >
                            [ ] {l.lotNo} · {l.than} than
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              {printError && (
                <div className="rounded bg-red-500/10 border border-red-500/40 px-3 py-2 text-sm text-red-300">
                  {printError}
                </div>
              )}
            </div>
            <div className="border-t border-slate-700 px-5 py-3 flex items-center justify-end gap-2 bg-slate-900">
              <button
                onClick={handleClose}
                className="px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white"
              >
                Close
              </button>
              <button
                onClick={handleShare}
                disabled={sharing}
                className="px-4 py-1.5 rounded text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white"
              >
                {sharing ? 'Sharing…' : '📤 WhatsApp'}
              </button>
              <button
                onClick={handlePrint}
                disabled={printing}
                className="px-4 py-1.5 rounded text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white"
              >
                {printing ? 'Printing…' : '🖨 Bluetooth Print'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
