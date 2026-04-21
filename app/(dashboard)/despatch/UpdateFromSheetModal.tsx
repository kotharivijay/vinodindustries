'use client'

import { useEffect, useState } from 'react'

interface FieldChange { field: string; oldValue: any; newValue: any }
interface RowChange {
  rowIndex: number
  lotEntryId: number
  entryId: number
  challan: number
  lotNo: string
  changes: FieldChange[]
  parentChanges: FieldChange[]
}
interface PreviewData {
  mode: 'preview'
  totalSynced: number
  missing: { rowIndex: number; lotEntryId: number }[]
  rowsWithUpdates: number
  parentEntriesAffected: number
  changes: RowChange[]
}

interface Props {
  open: boolean
  onClose: () => void
  onApplied: () => void
}

export default function UpdateFromSheetModal({ open, onClose, onApplied }: Props) {
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPreview(null); setError(null); setLoading(true)
    fetch('/api/despatch/update-from-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'preview' }),
    })
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setPreview(d) })
      .catch(e => setError(e?.message ?? 'Preview failed'))
      .finally(() => setLoading(false))
  }, [open])

  async function apply() {
    setApplying(true); setError(null)
    try {
      const res = await fetch('/api/despatch/update-from-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apply' }),
      })
      const d = await res.json()
      if (!res.ok || d.error) { setError(d.error ?? `HTTP ${res.status}`); return }
      alert(`✓ Updated ${d.parentsUpdated} challans + ${d.childrenUpdated} lot rows.\nFields changed: ${d.fieldsChanged?.parent ?? 0} parent + ${d.fieldsChanged?.child ?? 0} child.`)
      onApplied(); onClose()
    } catch (e: any) { setError(e?.message ?? 'Apply failed') }
    finally { setApplying(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Update from Sheet — Preview</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Only fills blank DB fields with sheet values. Existing DB values are never overwritten.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && <div className="text-center text-gray-400 py-10">Comparing sheet vs DB…</div>}
          {error && <div className="text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-3 text-sm mb-4">{error}</div>}
          {preview && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                <Stat label="Synced rows scanned" value={preview.totalSynced} />
                <Stat label="Lot rows with updates" value={preview.rowsWithUpdates} color="text-green-600" />
                <Stat label="Challans affected" value={preview.parentEntriesAffected} color="text-indigo-600" />
                <Stat label="Missing DB record" value={preview.missing?.length ?? 0} color={(preview.missing?.length ?? 0) > 0 ? 'text-amber-600' : 'text-gray-500'} />
              </div>

              {preview.rowsWithUpdates === 0 ? (
                <div className="text-center text-gray-400 py-8">Nothing to update — all blank DB fields either stay blank or the sheet has no new value.</div>
              ) : (
                <div className="space-y-2">
                  {preview.changes.map((c, i) => (
                    <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-1">
                        <span className="font-semibold text-gray-700 dark:text-gray-200">Ch {c.challan}</span>
                        <span className="text-indigo-600 dark:text-indigo-400 font-medium">{c.lotNo}</span>
                        <span className="text-gray-400">(row {c.rowIndex + 4} · id {c.lotEntryId})</span>
                      </div>
                      {c.parentChanges.length > 0 && (
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1">Challan:</span>
                          {c.parentChanges.map((f, fi) => (
                            <span key={fi} className="inline-block mr-3">
                              <span className="text-gray-400">{f.field}:</span> <span className="font-medium">{String(f.newValue)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {c.changes.length > 0 && (
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1">Lot:</span>
                          {c.changes.map((f, fi) => (
                            <span key={fi} className="inline-block mr-3">
                              <span className="text-gray-400">{f.field}:</span> <span className="font-medium">{String(f.newValue)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={applying} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">Cancel</button>
          <button
            onClick={apply}
            disabled={loading || applying || !preview || preview.rowsWithUpdates === 0}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {applying ? 'Applying…' : `Update ${preview?.rowsWithUpdates ?? 0} rows`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color = 'text-gray-800 dark:text-gray-100' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700 rounded-lg p-3 text-center">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
