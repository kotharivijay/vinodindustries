'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'

type RowStatus = 'ready' | 'missing_masters' | 'missing_lot' | 'duplicate' | 'skipped'

interface ImportRow {
  challanNo: number | null
  date: string
  partyName: string
  qualityName: string
  transportName: string
  lotNo: string
  than: number
  billNo: string
  rate: number | null
  pTotal: number | null
  lrNo: string
  bale: number | null
  missingMasters: string[]
  status: RowStatus
  skipReason?: string
  partyId: number | null
  qualityId: number | null
  transportId: number | null
}

interface Summary { total: number; ready: number; missing_masters: number; missing_lot: number; duplicate: number; skipped: number; sheetTotalThan: number }

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

export default function DespatchImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<'idle' | 'loading' | 'preview' | 'importing' | 'done'>('idle')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [result, setResult] = useState<{ imported: number; errors: any[]; dbTotalThan: number } | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [hideStatus, setHideStatus] = useState<Set<RowStatus>>(new Set())

  async function fetchSheet() {
    setStep('loading'); setError('')
    const res = await fetch('/api/despatch/import', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) { setError(data.message ?? 'Failed to fetch despatch sheet.'); setStep('idle'); return }
    setRows(data.rows)
    setSummary(data.summary)
    setSelected(new Set(data.rows.map((_: any, i: number) => i).filter((i: number) => data.rows[i].status === 'ready')))
    setStep('preview')
  }

  async function autoCreateMasters() {
    const missingRows = rows.filter((r) => r.status === 'missing_masters')
    if (missingRows.length === 0) return
    const res = await fetch('/api/despatch/import', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: missingRows }),
    })
    const data = await res.json()
    const updated = [...rows]
    let j = 0
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === 'missing_masters') updated[i] = data.rows[j++]
    }
    setRows(updated)
    setSummary(s => s ? {
      ...s,
      ready: updated.filter(r => r.status === 'ready').length,
      missing_masters: updated.filter(r => r.status === 'missing_masters').length,
      missing_lot: updated.filter(r => r.status === 'missing_lot').length,
    } : s)
    setSelected(new Set(updated.map((_, i) => i).filter((i) => updated[i].status === 'ready')))
  }

  async function handleImport() {
    const toImport = rows.filter((_, i) => selected.has(i) && rows[i].status === 'ready')
    setStep('importing')
    const res = await fetch('/api/despatch/import', {
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
    setSelected(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })
  }

  const readySelected = [...selected].filter((i) => rows[i]?.status === 'ready').length
  const selectedThan = [...selected].filter(i => rows[i]?.status === 'ready').reduce((s, i) => s + (rows[i]?.than ?? 0), 0)

  const D_HEADERS = ['Status', 'Skip Reason', 'Date', 'Challan', 'Party', 'Quality', 'Lot No', 'Than', 'Rate', 'P.Total', 'Transport', 'LR No', 'Bill No', 'Issue']

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
      row.date,
      row.challanNo ?? '',
      row.partyName,
      row.qualityName,
      row.lotNo,
      row.than,
      row.rate ?? '',
      row.pTotal ?? '',
      row.transportName,
      row.lrNo,
      row.billNo,
      row.status === 'skipped' ? (row.skipReason ?? '') : row.missingMasters.join(', '),
    ]
  }

  function exportXLSX() {
    const data = [D_HEADERS, ...getDisplayRows().map(rowToArray)]
    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Despatch Import Preview')
    XLSX.writeFile(wb, 'despatch-import-preview.xlsx')
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.text('Despatch Import Preview', 14, 14)
    autoTable(doc, {
      head: [D_HEADERS],
      body: getDisplayRows().map(rowToArray),
      startY: 20,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [79, 70, 229] },
    })
    doc.save('despatch-import-preview.pdf')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">Import Despatch from Google Sheet</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">

          {step === 'idle' && (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">📦</div>
              <p className="text-gray-600 mb-2">Fetch data from <strong>Despatch Sheet (Sheet1)</strong></p>
              <p className="text-gray-400 text-sm mb-6">All rows will be previewed before import — no duplicate filtering</p>
              <button onClick={fetchSheet} className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700">
                Fetch Sheet Data
              </button>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mt-4 text-sm text-left">{error}</div>}
            </div>
          )}

          {step === 'loading' && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin text-4xl mb-4">⟳</div>
              Fetching data from Google Sheets...
            </div>
          )}

          {step === 'preview' && summary && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                <div className="border rounded-lg p-3 text-center bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600">
                  <div className="text-2xl font-bold text-gray-700">{summary.total}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Total Rows</div>
                </div>
                <div className="border rounded-lg p-3 text-center bg-green-50 border-green-200">
                  <div className="text-2xl font-bold text-green-700">{summary.ready}</div>
                  <div className="text-xs text-green-600 mt-0.5">Ready</div>
                </div>
                <div className="border rounded-lg p-3 text-center bg-yellow-50 border-yellow-200">
                  <div className="text-2xl font-bold text-yellow-700">{summary.missing_masters}</div>
                  <div className="text-xs text-yellow-600 mt-0.5">Missing Masters</div>
                </div>
                <div className="border rounded-lg p-3 text-center bg-red-50 border-red-200">
                  <div className="text-2xl font-bold text-red-700">{summary.missing_lot}</div>
                  <div className="text-xs text-red-600 mt-0.5">Missing Lot</div>
                </div>
                <div className="border rounded-lg p-3 text-center bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600">
                  <div className="text-2xl font-bold text-gray-500">{summary.duplicate}</div>
                  <div className="text-xs text-gray-400 mt-0.5">Duplicate</div>
                </div>
                <div className="border rounded-lg p-3 text-center bg-orange-50 border-orange-200">
                  <div className="text-2xl font-bold text-orange-600">{summary.skipped}</div>
                  <div className="text-xs text-orange-500 mt-0.5">Skipped</div>
                </div>
              </div>

              {summary.missing_masters > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-yellow-800">⚠ {summary.missing_masters} rows have missing masters (Party / Quality / Transport)</p>
                    <p className="text-xs text-yellow-600 mt-0.5">Click to auto-create all missing entries in master tables</p>
                  </div>
                  <button onClick={autoCreateMasters} className="bg-yellow-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-yellow-600 whitespace-nowrap ml-4">
                    Auto-create Masters
                  </button>
                </div>
              )}

              {summary.missing_lot > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
                  <p className="text-sm font-medium text-red-800">🔴 {summary.missing_lot} rows have no Lot No — these will be skipped.</p>
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

              {/* Filter checkboxes */}
              {(() => {
                const ALL_STATUSES: RowStatus[] = ['ready', 'missing_masters', 'missing_lot', 'duplicate', 'skipped']
                const allHidden = ALL_STATUSES.every(s => hideStatus.has(s))
                return (
                  <div className="flex flex-wrap gap-3 mb-3">
                    <span className="text-xs text-gray-500 font-medium self-center">Hide:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-gray-600">
                      <input type="checkbox" checked={allHidden}
                        onChange={() => setHideStatus(allHidden ? new Set() : new Set(ALL_STATUSES))} />
                      All
                    </label>
                    <span className="text-gray-300 self-center">|</span>
                    {ALL_STATUSES.map(s => (
                      <label key={s} className="flex items-center gap-1.5 cursor-pointer text-xs">
                        <input type="checkbox" checked={hideStatus.has(s)}
                          onChange={() => setHideStatus(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })} />
                        <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[s]}`}>{STATUS_LABEL[s]}</span>
                      </label>
                    ))}
                  </div>
                )
              })()}

              <div className="overflow-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 sticky top-0">
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
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Challan</th>
                      <th className="px-3 py-2 text-left">Party</th>
                      <th className="px-3 py-2 text-left">Quality</th>
                      <th className="px-3 py-2 text-left">Lot No</th>
                      <th className="px-3 py-2 text-right">Than</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">P.Total</th>
                      <th className="px-3 py-2 text-left">Transport</th>
                      <th className="px-3 py-2 text-left">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows.entries()]
                      .sort(([,a],[,b]) => (a.status === 'skipped' ? 1 : 0) - (b.status === 'skipped' ? 1 : 0))
                      .filter(([,row]) => !hideStatus.has(row.status))
                      .map(([i, row]) => (
                      <tr key={i} className={`border-b last:border-0 ${row.status === 'duplicate' || row.status === 'skipped' ? 'opacity-40' : row.status !== 'ready' ? 'opacity-60' : ''}`}>
                        <td className="px-3 py-1.5">
                          <input type="checkbox" checked={selected.has(i)} disabled={row.status !== 'ready'} onChange={() => toggleRow(i)} />
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[row.status]}`}>
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{row.date || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600">{row.challanNo ?? '—'}</td>
                        <td className="px-3 py-1.5 font-medium">{row.partyName || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600">{row.qualityName || '—'}</td>
                        <td className="px-3 py-1.5 text-indigo-700 font-medium">{row.lotNo || <span className="text-red-500">—</span>}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{row.than || '—'}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{row.rate ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{row.pTotal ?? '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600">{row.transportName || '—'}</td>
                        <td className="px-3 py-1.5 text-[10px]">
                          {row.status === 'skipped'
                            ? <span className="text-orange-600 font-medium">{row.skipReason}</span>
                            : <span className="text-yellow-700">{row.missingMasters.join(', ')}</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700 border-t dark:border-gray-600">
                    <tr>
                      <td colSpan={7} className="px-3 py-2 text-xs font-semibold text-gray-500">
                        {readySelected} rows selected
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-bold text-indigo-700">{selectedThan}</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {step === 'importing' && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin text-4xl mb-4">⟳</div>
              Importing {readySelected} rows...
            </div>
          )}

          {step === 'done' && result && summary && (
            <div className="py-8">
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">✅</div>
                <p className="text-2xl font-bold text-gray-800">{result.imported} rows imported</p>
                {result.errors.length > 0 && <p className="text-red-500 text-sm mt-1">{result.errors.length} errors</p>}
              </div>

              {/* Than comparison */}
              <div className="max-w-sm mx-auto border rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Than Verification</div>
                <div className="divide-y">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-600">Sheet Total Than</span>
                    <span className="font-bold text-gray-800">{summary.sheetTotalThan}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-600">DB Total Than (after import)</span>
                    <span className="font-bold text-gray-800">{result.dbTotalThan}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                    <span className="text-sm font-semibold text-gray-700">Match</span>
                    {summary.sheetTotalThan === result.dbTotalThan
                      ? <span className="text-green-600 font-bold">✅ Yes</span>
                      : <span className="text-red-500 font-bold">❌ Diff: {result.dbTotalThan - summary.sheetTotalThan > 0 ? '+' : ''}{result.dbTotalThan - summary.sheetTotalThan}</span>
                    }
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-between items-center">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'preview' && (
            <button onClick={handleImport} disabled={readySelected === 0}
              className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              Import {readySelected} Selected Rows (Than: {selectedThan})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
