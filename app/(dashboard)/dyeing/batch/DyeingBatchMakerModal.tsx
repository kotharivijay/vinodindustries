'use client'

import { useMemo, useRef, useState } from 'react'
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
    foldBatch: {
      lots: { lotNo: string; than: number }[]
    }
  }[]
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
        batches: selectedBatches.map(b => ({
          foldBatchId: b.batchId,
          foldNo: b.foldNo,
          batchNo: b.batchNo,
          shadeName: b.shadeName,
          marka: b.marka ?? null,
          totalThan: b.totalThan,
          totalWeight: b.totalWeight,
        })),
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
              {showPicker ? 'Batch Maker Slip' : `Saved: ${savedSlip!.slipNo}`}
            </h2>
            <p className="text-xs text-slate-400">
              {showPicker
                ? 'Pick the fold batches you are physically assembling — one slip, one serial.'
                : 'Connect a Bluetooth thermal printer and tap Print to give Shanker the slip.'}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white text-xl leading-none px-2"
          >
            ✕
          </button>
        </div>

        {showPicker && (
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

        {showPicker && innerTab === 'saved' ? (
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
                      {!cancelled && (
                        <button
                          onClick={() => handleCancelSlip(s)}
                          disabled={cancellingId === s.id}
                          className="shrink-0 text-xs bg-red-600/80 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-3 py-1.5 rounded"
                        >
                          {cancellingId === s.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
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

              <div>
                <input
                  type="text"
                  placeholder="Search fold no, batch no, shade, marka, lot…"
                  value={batchSearch}
                  onChange={e => { setBatchSearch(e.target.value); setDebSearch(e.target.value) }}
                  className="w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                />
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
                  Slip {savedSlip!.slipNo} saved.
                </div>
                <div className="text-xs text-slate-300 mt-1">
                  {savedSlip!.batchMakerName} · {new Date(savedSlip!.date).toLocaleDateString('en-IN')}
                </div>
              </div>
              <div className="rounded border border-slate-700 divide-y divide-slate-800">
                {savedSlip!.batches.map((b, i) => (
                  <div key={i} className="px-3 py-2 text-sm">
                    <div className="text-white">
                      Fold {b.foldNoSnapshot} · B{b.batchNoSnapshot}
                      {b.shadeNameSnapshot && (
                        <span className="ml-2 text-slate-300">{b.shadeNameSnapshot}</span>
                      )}
                    </div>
                    {b.markaSnapshot && (
                      <div className="text-xs text-amber-400">Marka: {b.markaSnapshot}</div>
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
                ))}
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
