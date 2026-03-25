'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'

type RowStatus = 'ready' | 'missing_masters' | 'missing_lot' | 'duplicate' | 'skipped'

interface ImportRow {
  sn: number | null
  date: string
  challanNo: number | null
  partyName: string
  qualityName: string
  weaverName: string
  transportName: string
  lotNo: string
  than: number
  weight?: string
  lrNo?: string
  missingMasters: string[]
  status: RowStatus
  skipReason?: string
  partyId: number | null
  qualityId: number | null
  weaverId: number | null
  transportId: number | null
}

interface Summary { total: number; ready: number; missing_masters: number; missing_lot: number; duplicate: number; skipped: number }

const STATUS_STYLE: Record<RowStatus, string> = {
  ready: 'bg-green-100 text-green-700',
  missing_masters: 'bg-yellow-100 text-yellow-700',
  missing_lot: 'bg-red-100 text-red-700',
  duplicate: 'bg-gray-100 text-gray-500',
  skipped: 'bg-orange-100 text-orange-600',
}
const STATUS_LABEL: Record<RowStatus, string> = {
  ready: 'Ready',
  missing_masters: 'Missing Masters',
  missing_lot: 'Missing Lot No',
  duplicate: 'Duplicate',
  skipped: 'Skip',
}

export default function GreyImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<'idle' | 'loading' | 'preview' | 'importing' | 'done'>('idle')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [result, setResult] = useState<{ imported: number; errors: any[] } | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [hideStatus, setHideStatus] = useState<Set<RowStatus>>(new Set())

  async function fetchSheet() {
    setStep('loading'); setError('')
    const res = await fetch('/api/grey/import', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) {
      setError(data.message ?? 'Failed to fetch sheet.')
      setStep('idle'); return
    }
    setRows(data.rows)
    setSummary(data.summary)
    // Pre-select all ready rows
    setSelected(new Set(data.rows.map((_: any, i: number) => i).filter((i: number) => data.rows[i].status === 'ready')))
    setStep('preview')
  }

  async function autoCreateMasters() {
    const missingRows = rows.filter((r) => r.status === 'missing_masters')
    if (missingRows.length === 0) return
    const res = await fetch('/api/grey/import', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: missingRows }),
    })
    const data = await res.json()
    // Merge updated rows back
    const updated = [...rows]
    let j = 0
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === 'missing_masters') {
        updated[i] = data.rows[j++]
      }
    }
    setRows(updated)
    const newSummary = {
      total: updated.length,
      ready: updated.filter((r) => r.status === 'ready').length,
      missing_masters: updated.filter((r) => r.status === 'missing_masters').length,
      missing_lot: updated.filter((r) => r.status === 'missing_lot').length,
      duplicate: updated.filter((r) => r.status === 'duplicate').length,
      skipped: updated.filter((r) => r.status === 'skipped').length,
    }
    setSummary(newSummary)
    // Add newly ready rows to selection
    setSelected(new Set(updated.map((_, i) => i).filter((i) => updated[i].status === 'ready')))
  }

  async function handleImport() {
    const toImport = rows.filter((_, i) => selected.has(i) && rows[i].status === 'ready')
    setStep('importing')
    const res = await fetch('/api/grey/import', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: toImport }),
    })
    const data = await res.json()
    setResult(data)
    setStep('done')
    onImported()
  }

  function toggleRow(i: number) {
    setSelected((prev) => {
      const s = new Set(prev)
      s.has(i) ? s.delete(i) : s.add(i)
      return s
    })
  }

  const readySelected = [...selected].filter((i) => rows[i]?.status === 'ready').length

  const HEADERS = ['Status', 'Skip Reason', 'SN', 'Date', 'Challan', 'Party', 'Quality', 'Than', 'Lot No', 'Weaver', 'Transport', 'Weight', 'LR No', 'Issue']

  function getDisplayRows() {
    return [...rows.entries()]
      .sort(([,a],[,b]) => (a.status === 'skipped' ? 1 : 0) - (b.status === 'skipped' ? 1 : 0))
      .filter(([,row]) => !hideStatus.has(row.status))
      .map(([,row]) => row)
  }

  function rowToArray(row: ImportRow) {
    return [
      STATUS_LABEL[row.status],
      row.skipReason ?? '',
      row.sn ?? '',
      row.date,
      row.challanNo ?? '',
      row.partyName,
      row.qualityName,
      row.than,
      row.lotNo,
      row.weaverName,
      row.transportName,
      row.weight ?? '',
      row.lrNo ?? '',
      row.status === 'skipped' ? (row.skipReason ?? '') : row.missingMasters.join(', '),
    ]
  }

  function exportXLSX() {
    const data = [HEADERS, ...getDisplayRows().map(rowToArray)]
    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Grey Import Preview')
    XLSX.writeFile(wb, 'grey-import-preview.xlsx')
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.text('Grey Import Preview', 14, 14)
    autoTable(doc, {
      head: [HEADERS],
      body: getDisplayRows().map(rowToArray),
      startY: 20,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [79, 70, 229] },
    })
    doc.save('grey-import-preview.pdf')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">Import from Google Sheet</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">

          {/* Idle */}
          {step === 'idle' && (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">📊</div>
              <p className="text-gray-600 mb-2">Fetch data from <strong>Inwerd Gray 2025-26</strong></p>
              <p className="text-gray-400 text-sm mb-6">New rows will be previewed before import</p>
              <button onClick={fetchSheet} className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700">
                Fetch Sheet Data
              </button>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mt-4 text-sm text-left">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Loading */}
          {step === 'loading' && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin text-4xl mb-4">⟳</div>
              Fetching data from Google Sheets...
            </div>
          )}

          {/* Preview */}
          {step === 'preview' && summary && (
            <>
              {/* Summary bar */}
              <div className="grid grid-cols-5 gap-3 mb-4">
                {[
                  { label: 'Ready to Import', value: summary.ready, color: 'bg-green-50 text-green-700 border-green-200' },
                  { label: 'Missing Masters', value: summary.missing_masters, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
                  { label: 'Missing Lot No', value: summary.missing_lot, color: 'bg-red-50 text-red-700 border-red-200' },
                  { label: 'Duplicate (skip)', value: summary.duplicate, color: 'bg-gray-50 text-gray-500 border-gray-200' },
                  { label: 'Skipped (reason)', value: summary.skipped, color: 'bg-orange-50 text-orange-600 border-orange-200' },
                ].map((s) => (
                  <div key={s.label} className={`border rounded-lg p-3 text-center ${s.color}`}>
                    <div className="text-2xl font-bold">{s.value}</div>
                    <div className="text-xs mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Auto-create button */}
              {summary.missing_masters > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-yellow-800">⚠ {summary.missing_masters} rows have missing masters (Party / Quality / Weaver / Transport)</p>
                    <p className="text-xs text-yellow-600 mt-0.5">Click to auto-create all missing entries in master tables</p>
                  </div>
                  <button onClick={autoCreateMasters} className="bg-yellow-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-yellow-600 whitespace-nowrap ml-4">
                    Auto-create Masters
                  </button>
                </div>
              )}

              {/* Export buttons */}
              <div className="flex justify-end gap-2 mb-3">
                <button onClick={exportXLSX} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700">
                  ⬇ Export XLSX
                </button>
                <button onClick={exportPDF} className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-700">
                  ⬇ Export PDF
                </button>
              </div>

              {/* Missing lot notification */}
              {summary.missing_lot > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
                  <p className="text-sm font-medium text-red-800">🔴 {summary.missing_lot} rows have no Lot No — these cannot be imported.</p>
                  <p className="text-xs text-red-600 mt-0.5">Update the Google Sheet with Lot Nos, then re-fetch.</p>
                </div>
              )}

              {/* Filter checkboxes */}
              {(() => {
                const ALL_STATUSES: RowStatus[] = ['ready', 'missing_masters', 'missing_lot', 'duplicate', 'skipped']
                const allHidden = ALL_STATUSES.every(s => hideStatus.has(s))
                return (
                  <div className="flex flex-wrap gap-3 mb-3">
                    <span className="text-xs text-gray-500 font-medium self-center">Hide:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-gray-600">
                      <input
                        type="checkbox"
                        checked={allHidden}
                        onChange={() => setHideStatus(allHidden ? new Set() : new Set(ALL_STATUSES))}
                      />
                      All
                    </label>
                    <span className="text-gray-300 self-center">|</span>
                    {ALL_STATUSES.map((s) => (
                      <label key={s} className="flex items-center gap-1.5 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={hideStatus.has(s)}
                          onChange={() => setHideStatus(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })}
                        />
                        <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[s]}`}>{STATUS_LABEL[s]}</span>
                      </label>
                    ))}
                  </div>
                )
              })()}

              {/* Preview table */}
              <div className="overflow-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left w-8">
                        <input type="checkbox"
                          checked={readySelected === summary.ready && summary.ready > 0}
                          onChange={(e) => {
                            if (e.target.checked) setSelected(new Set(rows.map((_, i) => i).filter(i => rows[i].status === 'ready')))
                            else setSelected(new Set())
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">SN</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Challan</th>
                      <th className="px-3 py-2 text-left">Party</th>
                      <th className="px-3 py-2 text-left">Quality</th>
                      <th className="px-3 py-2 text-right">Than</th>
                      <th className="px-3 py-2 text-left">Lot No</th>
                      <th className="px-3 py-2 text-left">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows.entries()]
                      .sort(([,a],[,b]) => (a.status === 'skipped' ? 1 : 0) - (b.status === 'skipped' ? 1 : 0))
                      .filter(([,row]) => !hideStatus.has(row.status))
                      .map(([i, row]) => (
                      <tr key={i} className={`border-b last:border-0 ${row.status === 'duplicate' || row.status === 'skipped' ? 'opacity-40' : ''}`}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={selected.has(i)}
                            disabled={row.status !== 'ready'}
                            onChange={() => toggleRow(i)}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[row.status]}`}>
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-600">{row.sn ?? '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600">{row.date || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600">{row.challanNo ?? '—'}</td>
                        <td className="px-3 py-1.5 font-medium">{row.partyName || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600">{row.qualityName || '—'}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{row.than || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600">{row.lotNo || <span className="text-red-500">—</span>}</td>
                        <td className="px-3 py-1.5">
                          {row.status === 'skipped'
                            ? <span className="text-orange-600 font-medium">{row.skipReason}</span>
                            : <span className="text-yellow-700">{row.missingMasters.join(', ')}</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Importing */}
          {step === 'importing' && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin text-4xl mb-4">⟳</div>
              Importing {readySelected} rows...
            </div>
          )}

          {/* Done */}
          {step === 'done' && result && (
            <div className="py-8">
              <div className="text-center mb-4">
                <div className="text-5xl mb-3">{result.imported > 0 ? '✅' : '⚠️'}</div>
                <p className="text-2xl font-bold text-gray-800">{result.imported} rows imported</p>
              </div>
              {result.errors.length > 0 && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-red-700 mb-2">{result.errors.length} rows failed:</p>
                  <div className="max-h-48 overflow-auto space-y-1">
                    {result.errors.map((e: any, i: number) => (
                      <p key={i} className="text-xs text-red-600">SN {e.sn ?? '?'}: {e.error}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-between items-center">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'preview' && (
            <button
              onClick={handleImport}
              disabled={readySelected === 0}
              className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Import {readySelected} Selected Rows
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
