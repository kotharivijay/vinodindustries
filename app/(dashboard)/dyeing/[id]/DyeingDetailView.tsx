'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { generateSlipPDF, sharePDF, type SlipData } from '@/lib/pdf-share'

interface Lot { id: number; lotNo: string; than: number }
interface Chemical {
  id: number
  name: string
  quantity: number | null
  unit: string
  rate: number | null
  cost: number | null
  processTag?: string | null
}
interface Addition {
  id: number
  roundNo: number
  type: string
  defectType: string | null
  defectPhoto: string | null
  reason: string | null
  createdAt: string
  machine?: { name: string } | null
  operator?: { name: string } | null
  chemicals: Chemical[]
}

interface Entry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  notes: string | null
  shadeName?: string | null
  // Slip-level descriptor (typed in dyeing form Step 2).
  shadeDescription?: string | null
  lots: Lot[]
  chemicals: Chemical[]
  machine?: { id: number; name: string } | null
  operator?: { id: number; name: string } | null
  foldBatch?: {
    batchNo: number
    foldProgram?: { foldNo: string }
    shade?: { name: string; description?: string | null }
    // Per-batch descriptor — wins over shade.description (Hitset / APC).
    shadeDescription?: string | null
  } | null
  status?: string
  totalRounds?: number
  additions?: Addition[]
}

// Editable row used by the Round edit modal. Keeps the original chemicalId
// link by default so editing only qty/rate doesn't sever the master-data tie.
interface EditableItem {
  chemicalId: number | null
  name: string
  quantity: string
  unit: string
  rate: string
}

export default function DyeingDetailView({ id }: { id: string }) {
  const router = useRouter()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

  // Edit Round state — null when closed.
  const [editingRound, setEditingRound] = useState<Addition | null>(null)
  const [editItems, setEditItems] = useState<EditableItem[]>([])
  const [savingRound, setSavingRound] = useState(false)
  const [deletingRound, setDeletingRound] = useState(false)
  const [roundError, setRoundError] = useState('')

  function openEditRound(a: Addition) {
    setRoundError('')
    setEditingRound(a)
    setEditItems(
      (a.chemicals ?? []).map(c => ({
        chemicalId: (c as any).chemicalId ?? null,
        name: c.name,
        quantity: c.quantity != null ? String(c.quantity) : '',
        unit: c.unit ?? 'kg',
        rate: c.rate != null ? String(c.rate) : '',
      })),
    )
  }

  function updateItem(idx: number, patch: Partial<EditableItem>) {
    setEditItems(items => items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function removeItem(idx: number) {
    setEditItems(items => items.filter((_, i) => i !== idx))
  }

  function addBlankItem() {
    setEditItems(items => [...items, { chemicalId: null, name: '', quantity: '', unit: 'kg', rate: '' }])
  }

  async function saveRound() {
    if (!editingRound) return
    setRoundError('')
    setSavingRound(true)
    try {
      const payload = {
        chemicals: editItems
          .filter(c => c.name.trim())
          .map(c => {
            const qty = parseFloat(c.quantity) || 0
            const rate = c.rate !== '' ? parseFloat(c.rate) : null
            const cost = rate != null ? Math.round(qty * rate * 100) / 100 : null
            return { chemicalId: c.chemicalId, name: c.name.trim(), quantity: qty, unit: c.unit || 'kg', rate, cost }
          }),
      }
      const res = await fetch(`/api/dyeing/${id}/additions/${editingRound.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setRoundError(data?.error ?? 'Save failed'); return }
      // Refetch the slip so all rounds + costs update consistently.
      const refreshed = await fetch(`/api/dyeing/${id}`).then(r => r.json())
      setEntry(refreshed)
      setEditingRound(null)
    } catch (e: any) {
      setRoundError(e?.message ?? 'Network error')
    } finally {
      setSavingRound(false)
    }
  }

  async function deleteRound() {
    if (!editingRound) return
    if (!window.confirm(`Delete Round ${editingRound.roundNo} entirely? This removes all its items and decrements the slip's total rounds.`)) return
    setDeletingRound(true)
    try {
      const res = await fetch(`/api/dyeing/${id}/additions/${editingRound.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setRoundError(data?.error ?? 'Delete failed'); return }
      const refreshed = await fetch(`/api/dyeing/${id}`).then(r => r.json())
      setEntry(refreshed)
      setEditingRound(null)
    } catch (e: any) {
      setRoundError(e?.message ?? 'Network error')
    } finally {
      setDeletingRound(false)
    }
  }

  useEffect(() => {
    fetch(`/api/dyeing/${id}`)
      .then(r => r.json())
      .then(d => { setEntry(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  async function handleSharePDF() {
    if (!entry) return
    setSharing(true)
    try {
      const slipLots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo, than: entry.than }]
      // Combine shade name + per-batch descriptor (Hitset / APC use-case)
      // into a single label for the shared PDF.
      const baseName = entry.shadeName ?? entry.foldBatch?.shade?.name ?? null
      const desc = entry.shadeDescription || entry.foldBatch?.shadeDescription || entry.foldBatch?.shade?.description || null
      const combinedShade = baseName ? (desc ? `${baseName} — ${desc}` : baseName) : null
      const slip: SlipData = {
        slipNo: entry.slipNo,
        date: entry.date,
        shadeName: combinedShade,
        lots: slipLots.map(l => ({ lotNo: l.lotNo, than: l.than })),
        chemicals: (entry.chemicals || []).map(c => ({
          name: c.name,
          quantity: c.quantity,
          unit: c.unit,
          rate: c.rate,
          cost: c.cost,
          processTag: c.processTag,
        })),
        notes: entry.notes,
        status: entry.status,
        machine: entry.machine?.name ?? null,
        operator: entry.operator?.name ?? null,
        totalRounds: entry.totalRounds ?? null,
      }
      const blob = generateSlipPDF(slip)
      await sharePDF(blob, `dyeing_slip_${entry.slipNo}.pdf`)
    } catch (err) {
      console.error('PDF share failed', err)
      alert('Failed to share PDF')
    } finally {
      setSharing(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>
  if (!entry) return <div className="p-8 text-red-500">Entry not found.</div>

  const lots = entry.lots?.length ? entry.lots : [{ id: 0, lotNo: entry.lotNo, than: entry.than }]
  const totalThan = lots.reduce((s, l) => s + l.than, 0)
  const totalCost = entry.chemicals?.reduce((s, c) => s + (c.cost ?? 0), 0) ?? 0
  const costPerThan = totalThan > 0 ? totalCost / totalThan : 0

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">&larr; Back</button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Slip #{entry.slipNo}</h1>
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleSharePDF}
            disabled={sharing}
            className="text-sm font-medium text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 border border-green-200 dark:border-green-700 rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            {sharing ? 'Preparing…' : '📄 Share PDF'}
          </button>
          <Link href={`/dyeing/${id}/print`} target="_blank" className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5">
            Print
          </Link>
          <Link href={`/dyeing/${id}/edit`} className="text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 border border-purple-200 dark:border-purple-700 rounded-lg px-3 py-1.5">
            Edit
          </Link>
        </div>
      </div>

      {/* Slip Info Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Slip Details</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400">Date</p>
            <p className="font-medium text-gray-800 dark:text-gray-100">{new Date(entry.date).toLocaleDateString('en-IN')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Slip No</p>
            <p className="font-medium text-gray-800 dark:text-gray-100">{entry.slipNo}</p>
          </div>
          {(entry.shadeName || entry.foldBatch?.shade?.name) && (() => {
            const name = entry.shadeName || entry.foldBatch?.shade?.name || ''
            // Slip-level descriptor wins, then fold-batch, then master.
            const desc = entry.shadeDescription || entry.foldBatch?.shadeDescription || entry.foldBatch?.shade?.description || null
            return (
              <div>
                <p className="text-xs text-gray-400">Shade</p>
                <p className="font-medium text-gray-800 dark:text-gray-100">
                  {name}{desc ? <span className="text-gray-500 dark:text-gray-400"> — {desc}</span> : null}
                </p>
              </div>
            )
          })()}
          {entry.foldBatch && (
            <div>
              <p className="text-xs text-gray-400">Fold / Batch</p>
              <p className="font-medium text-gray-800 dark:text-gray-100">Fold {entry.foldBatch.foldProgram?.foldNo ?? '?'} / Batch {entry.foldBatch.batchNo}</p>
            </div>
          )}
          {entry.machine && (
            <div>
              <p className="text-xs text-gray-400">Machine</p>
              <p className="font-medium text-gray-800 dark:text-gray-100">{entry.machine.name}</p>
            </div>
          )}
          {entry.operator && (
            <div>
              <p className="text-xs text-gray-400">Operator</p>
              <p className="font-medium text-gray-800 dark:text-gray-100">{entry.operator.name}</p>
            </div>
          )}
          {entry.notes && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400">Notes</p>
              <p className="text-gray-600 dark:text-gray-400">{entry.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Lots Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Lots</h2>
          <span className="text-xs text-gray-400">{lots.length} lot{lots.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="space-y-2">
          {lots.map((l, i) => (
            <div key={l.id || i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 rounded-lg px-4 py-2.5">
              <Link href={`/lot/${encodeURIComponent(l.lotNo)}`} className="text-sm font-semibold text-purple-700 dark:text-purple-400 hover:underline">
                {l.lotNo}
              </Link>
              <span className="text-sm text-gray-600 dark:text-gray-400">{l.than} than</span>
            </div>
          ))}
        </div>
        {lots.length > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Total Than</span>
            <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{totalThan}</span>
          </div>
        )}
      </div>

      {/* Chemicals Card */}
      {entry.chemicals?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Chemicals Used</h2>
            <span className="text-xs text-gray-400">{entry.chemicals.length} items</span>
          </div>
          <div className="space-y-2">
            {entry.chemicals.map((c) => (
              <div key={c.id} className="border border-gray-200 dark:border-gray-600 rounded-xl p-3 bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.name}</span>
                    {c.processTag && (
                      <span className="text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">{c.processTag}</span>
                    )}
                  </div>
                  {c.cost != null && c.cost > 0 && (
                    <span className="text-sm font-semibold text-purple-700 dark:text-purple-400">&#8377;{c.cost.toFixed(2)}</span>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                  {c.quantity != null && <span>{c.quantity} {c.unit}</span>}
                  {c.rate != null && <span>@ &#8377;{c.rate}/{c.unit}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Cost Summary */}
          {totalCost > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Round 1 Cost</span>
                <span className="text-lg font-bold text-purple-700 dark:text-purple-400">&#8377;{totalCost.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Additions / Re-Dye History */}
      {entry.additions && entry.additions.length > 0 && (
        <div className="space-y-4 mb-4">
          {entry.additions.map((a) => {
            const addCost = a.chemicals?.reduce((s: number, c: Chemical) => s + (c.cost ?? 0), 0) ?? 0
            return (
              <div key={a.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Round {a.roundNo} {a.type === 're-dye' ? '(Re-Dye)' : '(Addition)'}
                    </h2>
                    {a.defectType && (
                      <span className="text-[10px] font-medium bg-red-900/30 text-red-300 px-1.5 py-0.5 rounded capitalize">{a.defectType}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{new Date(a.createdAt).toLocaleDateString('en-IN')}</span>
                    <button
                      onClick={() => openEditRound(a)}
                      className="text-[11px] font-medium text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 border border-purple-200 dark:border-purple-700 rounded px-2 py-0.5"
                      title="Edit items and quantities for this round"
                    >
                      ✏ Edit
                    </button>
                  </div>
                </div>

                {a.reason && (
                  <p className="text-xs text-gray-400 mb-2">Reason: {a.reason}</p>
                )}

                {(a.machine || a.operator) && (
                  <div className="flex gap-4 text-xs text-gray-400 mb-2">
                    {a.machine && <span>Machine: {a.machine.name}</span>}
                    {a.operator && <span>Operator: {a.operator.name}</span>}
                  </div>
                )}

                {a.defectPhoto && (
                  <div className="mb-2">
                    <a href={a.defectPhoto} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">View Defect Photo</a>
                  </div>
                )}

                {a.chemicals?.length > 0 && (
                  <div className="space-y-1.5">
                    {a.chemicals.map((c: Chemical) => (
                      <div key={c.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2">
                        <span className="text-sm text-gray-800 dark:text-gray-100">{c.name}</span>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          {c.quantity != null && <span>{c.quantity} {c.unit}</span>}
                          {c.cost != null && c.cost > 0 && <span className="text-purple-400 font-medium">&#8377;{c.cost.toFixed(2)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {addCost > 0 && (
                  <div className="mt-3 flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-2">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Round {a.roundNo} Cost</span>
                    <span className="text-sm font-bold text-red-600 dark:text-red-400">+&#8377;{addCost.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Actual Total (all rounds) */}
      {(() => {
        const additionsCost = entry.additions?.reduce((s, a) =>
          s + (a.chemicals?.reduce((s2: number, c: Chemical) => s2 + (c.cost ?? 0), 0) ?? 0), 0) ?? 0
        const actualTotal = totalCost + additionsCost
        if (actualTotal > 0 && additionsCost > 0) {
          return (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Cost Summary</h2>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Round 1 (Planned)</span>
                  <span className="text-sm text-gray-300">&#8377;{totalCost.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-red-400">Additions / Re-Dye</span>
                  <span className="text-sm text-red-400">+&#8377;{additionsCost.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-gray-700 pt-2">
                  <span className="text-sm font-bold text-gray-200">Actual Total</span>
                  <span className="text-lg font-bold text-purple-400">&#8377;{actualTotal.toFixed(2)}</span>
                </div>
                {costPerThan > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Actual Cost/Than</span>
                    <span className="text-sm text-indigo-400">&#8377;{(actualTotal / totalThan).toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )
        }
        if (totalCost > 0 && additionsCost === 0 && costPerThan > 0) {
          return (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
              <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Cost per Than</span>
                <span className="text-lg font-bold text-indigo-700 dark:text-indigo-400">&#8377;{costPerThan.toFixed(2)}</span>
              </div>
            </div>
          )
        }
        return null
      })()}

      {editingRound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-lg bg-gray-900 border border-gray-700 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-700 px-5 py-3">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Edit Round {editingRound.roundNo} {editingRound.type === 're-dye' ? '(Re-Dye)' : '(Addition)'}
                </h2>
                <p className="text-xs text-gray-400">Slip #{entry.slipNo} — change item / quantity / rate</p>
              </div>
              <button onClick={() => setEditingRound(null)} className="text-gray-400 hover:text-white text-xl leading-none px-2">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {editItems.length === 0 ? (
                <div className="text-center text-gray-500 text-sm py-8">No items. Tap + Add Item to add one.</div>
              ) : (
                <>
                  <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wide text-gray-500 px-1">
                    <div className="col-span-5">Item</div>
                    <div className="col-span-2 text-right">Qty</div>
                    <div className="col-span-1">Unit</div>
                    <div className="col-span-2 text-right">Rate</div>
                    <div className="col-span-1 text-right">Cost</div>
                    <div className="col-span-1"></div>
                  </div>
                  {editItems.map((it, i) => {
                    const qty = parseFloat(it.quantity) || 0
                    const rate = it.rate !== '' ? parseFloat(it.rate) : null
                    const cost = rate != null ? qty * rate : null
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          value={it.name}
                          onChange={e => updateItem(i, { name: e.target.value })}
                          placeholder="Chemical name"
                          className="col-span-5 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
                        />
                        <input
                          type="number" step="0.001" value={it.quantity}
                          onChange={e => updateItem(i, { quantity: e.target.value })}
                          className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white text-right"
                        />
                        <input
                          value={it.unit}
                          onChange={e => updateItem(i, { unit: e.target.value })}
                          className="col-span-1 bg-gray-800 border border-gray-700 rounded px-1 py-1.5 text-xs text-white"
                        />
                        <input
                          type="number" step="0.01" value={it.rate}
                          onChange={e => updateItem(i, { rate: e.target.value })}
                          className="col-span-2 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white text-right"
                        />
                        <div className="col-span-1 text-right text-xs text-purple-400">
                          {cost != null ? `₹${cost.toFixed(2)}` : '—'}
                        </div>
                        <button
                          onClick={() => removeItem(i)}
                          className="col-span-1 text-red-400 hover:text-red-300 text-sm"
                          title="Remove this item"
                        >✕</button>
                      </div>
                    )
                  })}
                </>
              )}

              <button
                onClick={addBlankItem}
                className="mt-2 w-full text-sm bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 text-gray-300 rounded px-3 py-2"
              >
                + Add Item
              </button>

              {roundError && (
                <div className="rounded bg-red-500/10 border border-red-500/40 px-3 py-2 text-sm text-red-300">
                  {roundError}
                </div>
              )}
            </div>

            <div className="border-t border-gray-700 px-5 py-3 flex items-center justify-between gap-2 bg-gray-900">
              <button
                onClick={deleteRound}
                disabled={deletingRound}
                className="text-xs bg-red-600/80 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded"
              >
                {deletingRound ? 'Deleting…' : 'Delete Round'}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingRound(null)}
                  className="px-3 py-1.5 rounded text-sm text-gray-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={saveRound}
                  disabled={savingRound}
                  className="px-4 py-1.5 rounded text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white"
                >
                  {savingRound ? 'Saving…' : 'Save Round'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
