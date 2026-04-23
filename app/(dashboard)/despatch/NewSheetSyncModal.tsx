'use client'

import { useEffect, useState } from 'react'

interface LotPreview {
  sheetLot: string
  resolvedLot: string
  than: number
  rate: number | null
  description: string | null
  quality: string | null
}

interface GroupPreview {
  challan: number
  date: string
  party: string
  quality: string
  totalThan: number
  lots: LotPreview[]
}

interface PreviewData {
  mode: 'preview'
  sheetRows: number
  parsedRows: number
  skipped: number
  skippedSamples: { row: number; reason: string; lot?: string; challan?: string }[]
  groups: GroupPreview[]
}

interface Props {
  open: boolean
  onClose: () => void
  onImported: () => void
}

export default function NewSheetSyncModal({ open, onClose, onImported }: Props) {
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPreview(null)
    setError(null)
    setLoading(true)
    fetch('/api/despatch/sync-new-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'preview' }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setPreview(d)
      })
      .catch(e => setError(e?.message ?? 'Preview failed'))
      .finally(() => setLoading(false))
  }, [open])

  async function apply() {
    setApplying(true)
    setError(null)
    try {
      const res = await fetch('/api/despatch/sync-new-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apply' }),
      })
      const d = await res.json()
      if (!res.ok || d.error) { setError(d.error ?? `HTTP ${res.status}`); return }
      alert(`✓ Imported ${d.entriesCreated} challans / ${d.lotsCreated} lots. Skipped ${d.skipped}.`)
      onImported()
      onClose()
    } catch (e: any) { setError(e?.message ?? 'Apply failed') }
    finally { setApplying(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Sync New Despatch — Preview</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Review the rows before importing. Nothing is written until you click Import.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && <div className="text-center text-gray-400 py-10">Fetching sheet + matching lots…</div>}
          {error && <div className="text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-3 text-sm mb-4">{error}</div>}
          {preview && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                <Stat label="Sheet rows" value={preview.sheetRows} />
                <Stat label="To import" value={preview.parsedRows} color="text-green-600" />
                <Stat label="Challans" value={preview.groups.length} color="text-indigo-600" />
                <Stat label="Skipped" value={preview.skipped} color={preview.skipped > 0 ? 'text-amber-600' : 'text-gray-500'} />
              </div>

              {preview.skipped > 0 && (
                <details className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <summary className="text-xs font-semibold text-amber-700 dark:text-amber-400 cursor-pointer">Skipped rows ({preview.skipped}) — not imported, col T stays empty</summary>
                  <ul className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-300">
                    {preview.skippedSamples.map((s, i) => (
                      <li key={i}>Row {s.row}: {s.reason}{s.lot ? ` — lot "${s.lot}"` : ''}{s.challan ? ` — ch ${s.challan}` : ''}</li>
                    ))}
                  </ul>
                </details>
              )}

              {preview.groups.length === 0 ? (
                <div className="text-center text-gray-400 py-8">No new rows to import.</div>
              ) : (
                <div className="space-y-3">
                  {preview.groups.map((g, gi) => (
                    <div key={gi} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 dark:bg-gray-700/50 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="font-semibold text-gray-700 dark:text-gray-200">Ch {g.challan}</span>
                        <span className="text-gray-500 dark:text-gray-400">{new Date(g.date).toLocaleDateString('en-IN')}</span>
                        <span className="font-medium text-gray-800 dark:text-gray-100">{g.party}</span>
                        <span className="text-gray-500 dark:text-gray-400">{g.quality}</span>
                        <span className="ml-auto font-semibold text-indigo-600 dark:text-indigo-400">{g.totalThan}</span>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {g.lots.map((l, li) => (
                            <tr key={li} className="border-t border-gray-100 dark:border-gray-700">
                              <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{l.sheetLot}{l.resolvedLot !== l.sheetLot && <span className="text-gray-400"> → {l.resolvedLot}</span>}</td>
                              <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{l.quality}</td>
                              <td className="px-3 py-1.5 text-right font-medium text-gray-700 dark:text-gray-200">{l.than}</td>
                              <td className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400">{l.rate != null ? `₹${l.rate}` : '—'}</td>
                              <td className="px-3 py-1.5 text-gray-400 italic max-w-[20rem] truncate">{l.description ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
            disabled={loading || applying || !preview || preview.parsedRows === 0}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {applying ? 'Importing…' : `Import ${preview?.parsedRows ?? 0} rows`}
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
