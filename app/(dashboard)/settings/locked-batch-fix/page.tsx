'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRole } from '../../RoleContext'

interface DownstreamRef {
  id: number
  lotNo: string
  than: number | null
  date?: string | null
  slipNo?: number | string | null
  challanNo?: number | null
  meter?: number | null
  boxes?: number | null
}

interface LotRow {
  fbl: { id: number; lotNo: string; than: number; partyName: string | null; qualityName: string | null }
  dyeingEntryLot: { id: number; lotNo: string; than: number; dyeingEntryId: number; dyeSlipNo: number; dyeingDoneAt: string | null } | null
  finishEntryLots: { id: number; lotNo: string; than: number; finishEntryId: number; finishSlipNo: number; finishDate: string }[]
  downstreamRefs: {
    foldingSlipLots: DownstreamRef[]
    packingLots: DownstreamRef[]
    despatchEntryLots: DownstreamRef[]
  }
}

interface Preview {
  batch: { id: number; foldNo: string; batchNo: number; cancelled: boolean; shadeName: string | null; shadeDescription: string | null }
  dyeEntries: { id: number; slipNo: number; status: string; dyeingDoneAt: string | null }[]
  lots: LotRow[]
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function LockedBatchFixPage() {
  const router = useRouter()
  const role = useRole()

  const [foldNo, setFoldNo] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)

  // Per-lot edit state (one lot at a time)
  const [editFblId, setEditFblId] = useState<number | null>(null)
  const [newLotNo, setNewLotNo] = useState('')
  const [newThan, setNewThan] = useState('')
  const [reason, setReason] = useState('')
  const [tickedFolding, setTickedFolding] = useState<Set<number>>(new Set())
  const [tickedPacking, setTickedPacking] = useState<Set<number>>(new Set())
  const [tickedDespatch, setTickedDespatch] = useState<Set<number>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [successAuditId, setSuccessAuditId] = useState<number | null>(null)

  if (role !== 'admin') {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">Locked Batch Lot Correction</h1>
        <p className="text-sm text-rose-600 dark:text-rose-400">This page is admin-only.</p>
      </div>
    )
  }

  async function fetchPreview() {
    setError(null)
    setSuccessAuditId(null)
    setPreview(null)
    setEditFblId(null)
    if (!foldNo.trim() || !batchNo.trim()) {
      setError('Enter both Fold No and Batch No')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/locked-batch?foldNo=${encodeURIComponent(foldNo.trim())}&batchNo=${encodeURIComponent(batchNo.trim())}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || `Fetch failed (${res.status})`)
      } else {
        setPreview(data)
      }
    } catch (e: any) {
      setError(e?.message || 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }

  function startEdit(lot: LotRow) {
    setEditFblId(lot.fbl.id)
    setNewLotNo(lot.fbl.lotNo)
    setNewThan(String(lot.fbl.than))
    setReason('')
    setTickedFolding(new Set())
    setTickedPacking(new Set())
    setTickedDespatch(new Set())
    setError(null)
    setSuccessAuditId(null)
  }

  function cancelEdit() {
    setEditFblId(null)
    setError(null)
  }

  function toggleTick(set: Set<number>, setSet: (s: Set<number>) => void, id: number) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSet(next)
  }

  async function submitFix(lot: LotRow) {
    const newLot = newLotNo.trim()
    const thanN = parseInt(newThan, 10)
    if (!newLot) { setError('New lot number required'); return }
    if (!Number.isFinite(thanN) || thanN < 1) { setError('Than must be a positive number'); return }

    const renaming = newLot.toUpperCase() !== lot.fbl.lotNo.toUpperCase()
    const thanChanging = thanN !== lot.fbl.than
    if (!renaming && !thanChanging) { setError('No change — adjust lot or than'); return }

    const summary = [
      `FoldBatchLot ${lot.fbl.id}: ${lot.fbl.lotNo} (${lot.fbl.than}) → ${newLot} (${thanN})`,
      lot.dyeingEntryLot && `DyeingEntryLot ${lot.dyeingEntryLot.id} (dye slip ${lot.dyeingEntryLot.dyeSlipNo}): rename + retune than`,
      ...lot.finishEntryLots.map(f => `FinishEntryLot ${f.id} (finish slip ${f.finishSlipNo}): rename${lot.finishEntryLots.length === 1 ? ' + retune than' : ' only'}`),
      tickedFolding.size && `${tickedFolding.size} FoldingSlipLot row(s) → rename only`,
      tickedPacking.size && `${tickedPacking.size} PackingLot row(s) → rename only`,
      tickedDespatch.size && `${tickedDespatch.size} DespatchEntryLot row(s) → rename only`,
    ].filter(Boolean).join('\n• ')

    if (!confirm(`This will execute the following in one transaction:\n\n• ${summary}\n\nProceed?`)) return

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/locked-batch/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          foldBatchLotId: lot.fbl.id,
          newLotNo: newLot,
          newThan: thanN,
          reason: reason.trim() || undefined,
          alsoRenameDownstream: {
            foldingSlipLotIds: Array.from(tickedFolding),
            packingLotIds: Array.from(tickedPacking),
            despatchEntryLotIds: Array.from(tickedDespatch),
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || `Fix failed (${res.status})`)
      } else {
        setSuccessAuditId(data.auditId)
        setEditFblId(null)
        await fetchPreview()
      }
    } catch (e: any) {
      setError(e?.message || 'Fix failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-32">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium">
          ← Back
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">🔧 Locked Batch Lot Correction</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Admin tool — cascades lot rename/than across FoldBatchLot + DyeingEntryLot + FinishEntryLot</p>
        </div>
      </div>

      {/* Fold + Batch input */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Fold No</label>
            <input type="text" value={foldNo} onChange={e => setFoldNo(e.target.value)} placeholder="e.g. 122"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Batch No</label>
            <input type="number" value={batchNo} onChange={e => setBatchNo(e.target.value)} placeholder="e.g. 31"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <button onClick={fetchPreview} disabled={loading}
            className="bg-purple-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50">
            {loading ? 'Fetching…' : 'Fetch Batch'}
          </button>
        </div>
        {error && (
          <div className="mt-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        {successAuditId !== null && (
          <div className="mt-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm rounded-lg px-3 py-2">
            ✅ Fix applied. Audit row: <strong>#{successAuditId}</strong>
          </div>
        )}
      </div>

      {preview && (
        <div className="space-y-4">
          {/* Batch summary */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">Fold {preview.batch.foldNo} · Batch {preview.batch.batchNo}</span>
              {preview.batch.cancelled && <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded">CANCELLED</span>}
              {preview.batch.shadeName && (
                <span className="text-xs text-gray-500 dark:text-gray-400">Shade: {preview.batch.shadeName}{preview.batch.shadeDescription ? ` — ${preview.batch.shadeDescription}` : ''}</span>
              )}
            </div>
            {preview.dyeEntries.length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Dye slip(s): {preview.dyeEntries.map(d => `#${d.slipNo}${d.dyeingDoneAt ? ' ✅' : ' ⏳'}`).join(', ')}
              </p>
            )}
            {preview.dyeEntries.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">⚠ Batch is not dyed — no DyeingEntry linked. Cascade will skip dye + finish.</p>
            )}
          </div>

          {/* Lot rows */}
          {preview.lots.map(lot => {
            const downstreamCount = lot.downstreamRefs.foldingSlipLots.length + lot.downstreamRefs.packingLots.length + lot.downstreamRefs.despatchEntryLots.length
            const isEditing = editFblId === lot.fbl.id
            const felCount = lot.finishEntryLots.length

            return (
              <div key={lot.fbl.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{lot.fbl.lotNo}</span>
                      <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{lot.fbl.than} than</span>
                      <span className="text-[10px] text-gray-400">FBL#{lot.fbl.id}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {lot.fbl.partyName || <em className="text-amber-600">no party</em>} · {lot.fbl.qualityName || <em className="text-amber-600">no quality</em>}
                    </p>
                    <div className="flex flex-wrap gap-3 text-[11px] mt-1">
                      <span className={lot.dyeingEntryLot ? 'text-purple-700 dark:text-purple-300' : 'text-gray-400'}>
                        Dye: {lot.dyeingEntryLot ? `DEL#${lot.dyeingEntryLot.id} · slip ${lot.dyeingEntryLot.dyeSlipNo} · ${lot.dyeingEntryLot.than} than` : 'none'}
                      </span>
                      <span className={felCount ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-400'}>
                        Finish: {felCount === 0 ? 'none' : felCount === 1 ? `FEL#${lot.finishEntryLots[0].id} · slip ${lot.finishEntryLots[0].finishSlipNo} · ${lot.finishEntryLots[0].than} than` : `${felCount} FELs`}
                      </span>
                      {downstreamCount > 0 && (
                        <span className="text-amber-700 dark:text-amber-300">⚠ {downstreamCount} downstream ref(s)</span>
                      )}
                    </div>
                  </div>
                  {!isEditing && (
                    <button onClick={() => startEdit(lot)}
                      className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 rounded-lg px-3 py-1.5 font-semibold hover:bg-purple-200">
                      ✏️ Edit lot / than
                    </button>
                  )}
                </div>

                {isEditing && (
                  <div className="border-t border-gray-100 dark:border-gray-700 bg-purple-50/40 dark:bg-purple-900/10 p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">New Lot No</label>
                        <input type="text" value={newLotNo} onChange={e => setNewLotNo(e.target.value)}
                          className="w-full border border-purple-300 dark:border-purple-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">New Than</label>
                        <input type="number" min={1} value={newThan} onChange={e => setNewThan(e.target.value)}
                          className="w-full border border-purple-300 dark:border-purple-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Reason (optional)</label>
                      <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. operator mistyped at intake"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                    </div>

                    {felCount > 1 && (
                      <div className="text-[11px] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300 rounded-lg px-3 py-2">
                        ⚠ {felCount} FinishEntryLot rows match — all will be renamed but than will <strong>not</strong> auto-rescale (fix manually if needed).
                      </div>
                    )}

                    {/* Downstream cascade — opt-in checkboxes */}
                    {downstreamCount > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Optional downstream rename (lot only, not than):</p>
                        <div className="space-y-2">
                          {lot.downstreamRefs.foldingSlipLots.length > 0 && (
                            <fieldset className="border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                              <legend className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 px-1">FoldingSlipLot ({lot.downstreamRefs.foldingSlipLots.length})</legend>
                              {lot.downstreamRefs.foldingSlipLots.map(r => (
                                <label key={r.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                                  <input type="checkbox" checked={tickedFolding.has(r.id)} onChange={() => toggleTick(tickedFolding, setTickedFolding, r.id)} className="w-3.5 h-3.5 accent-purple-600" />
                                  <span>FSL#{r.id} · Folding_recpt {r.slipNo ?? '—'} · {formatDate(r.date)} · {r.than ?? '—'} than</span>
                                </label>
                              ))}
                            </fieldset>
                          )}
                          {lot.downstreamRefs.packingLots.length > 0 && (
                            <fieldset className="border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                              <legend className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 px-1">PackingLot ({lot.downstreamRefs.packingLots.length})</legend>
                              {lot.downstreamRefs.packingLots.map(r => (
                                <label key={r.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                                  <input type="checkbox" checked={tickedPacking.has(r.id)} onChange={() => toggleTick(tickedPacking, setTickedPacking, r.id)} className="w-3.5 h-3.5 accent-purple-600" />
                                  <span>PL#{r.id} · {formatDate(r.date)} · {r.than ?? '—'} than · {r.boxes ?? 0} boxes</span>
                                </label>
                              ))}
                            </fieldset>
                          )}
                          {lot.downstreamRefs.despatchEntryLots.length > 0 && (
                            <fieldset className="border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                              <legend className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 px-1">DespatchEntryLot ({lot.downstreamRefs.despatchEntryLots.length})</legend>
                              {lot.downstreamRefs.despatchEntryLots.map(r => (
                                <label key={r.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                                  <input type="checkbox" checked={tickedDespatch.has(r.id)} onChange={() => toggleTick(tickedDespatch, setTickedDespatch, r.id)} className="w-3.5 h-3.5 accent-purple-600" />
                                  <span>DEL#{r.id} · Challan {r.challanNo ?? '—'} · {formatDate(r.date)} · {r.than ?? '—'} than</span>
                                </label>
                              ))}
                            </fieldset>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button onClick={() => submitFix(lot)} disabled={submitting}
                        className="flex-1 bg-purple-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50">
                        {submitting ? 'Applying…' : 'Apply Fix'}
                      </button>
                      <button onClick={cancelEdit} disabled={submitting}
                        className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-200">
                        Cancel
                      </button>
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
