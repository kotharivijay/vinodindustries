'use client'

import { useState } from 'react'

interface SheetRow {
  challanNo: number | null
  date: string
  partyName: string
  qualityName: string
  transportName: string
  lotNo: string
  than: number
  rate: number | null
  pTotal: number | null
  missingMasters: string[]
  partyId: number | null
  qualityId: number | null
  transportId: number | null
}

interface DbDupEntry { id: number; date: string; createdAt: string; than: number }
interface DbDupGroup {
  key: string; challanNo: number; lotNo: string; partyName: string; qualityName: string
  entries: DbDupEntry[]
}

interface Summary {
  sheetTotal: number; newCount: number; syncedCount: number
  dupGroupCount: number; dupEntryCount: number
}

type Tab = 'new' | 'duplicates'

export default function DespatchSyncModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'idle' | 'loading' | 'preview' | 'working' | 'done'>('idle')
  const [tab, setTab] = useState<Tab>('new')
  const [newRows, setNewRows] = useState<SheetRow[]>([])
  const [dbDuplicates, setDbDuplicates] = useState<DbDupGroup[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [selectedNew, setSelectedNew] = useState<Set<number>>(new Set())
  const [selectedDupIds, setSelectedDupIds] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<{ imported?: number; deleted?: number; errors?: any[] } | null>(null)
  const [error, setError] = useState('')

  async function fetchSync() {
    setStep('loading'); setError('')
    const res = await fetch('/api/despatch/sync')
    const data = await res.json()
    if (!res.ok) { setError(data.message ?? 'Failed to fetch.'); setStep('idle'); return }

    setNewRows(data.newRows)
    setDbDuplicates(data.dbDuplicates)
    setSummary(data.summary)

    // Pre-select: all new rows that are ready (have partyId & qualityId)
    const readyIdxs = new Set<number>(
      data.newRows.map((_: SheetRow, i: number) => i)
        .filter((i: number) => data.newRows[i].partyId && data.newRows[i].qualityId && data.newRows[i].lotNo)
    )
    setSelectedNew(readyIdxs)

    // Pre-select: all extra DB duplicate entries (keep first, delete rest)
    const dupIds = new Set<number>()
    for (const g of data.dbDuplicates as DbDupGroup[]) {
      g.entries.slice(1).forEach((e: DbDupEntry) => dupIds.add(e.id))
    }
    setSelectedDupIds(dupIds)

    setTab(data.summary.newCount > 0 ? 'new' : 'duplicates')
    setStep('preview')
  }

  async function handleImportNew() {
    const toImport = newRows.filter((_, i) => selectedNew.has(i) && newRows[i].partyId && newRows[i].qualityId)
    if (toImport.length === 0) return
    setStep('working')
    const res = await fetch('/api/despatch/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: toImport }),
    })
    const data = await res.json()
    setResult(r => ({ ...r, imported: data.imported, errors: data.errors }))
    setStep('done')
    onDone()
  }

  async function handleDeleteDups() {
    const ids = [...selectedDupIds]
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} duplicate entries from database? This cannot be undone.`)) return
    setStep('working')
    const res = await fetch('/api/despatch/sync', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const data = await res.json()
    setResult(r => ({ ...r, deleted: data.deleted }))
    setStep('done')
    onDone()
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN')
  const readyNewCount = [...selectedNew].filter(i => newRows[i]?.partyId && newRows[i]?.qualityId).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">🔄 Sync Despatch with Google Sheet</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">

          {step === 'idle' && (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">🔄</div>
              <p className="text-gray-600 mb-2 font-medium">Compare Google Sheet with Database</p>
              <p className="text-gray-400 text-sm mb-6">Finds rows not yet imported, and duplicate entries in the DB</p>
              <button onClick={fetchSync} className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700">
                Start Sync Check
              </button>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mt-4 text-sm">{error}</div>}
            </div>
          )}

          {step === 'loading' && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin text-4xl mb-4">⟳</div>
              Comparing sheet with database...
            </div>
          )}

          {step === 'working' && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin text-4xl mb-4">⟳</div>
              Processing...
            </div>
          )}

          {step === 'done' && result && (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">✅</div>
              {result.imported != null && <p className="text-xl font-bold text-gray-800 mb-1">{result.imported} rows imported</p>}
              {result.deleted != null && <p className="text-xl font-bold text-gray-800 mb-1">{result.deleted} duplicate entries deleted</p>}
              {(result.errors?.length ?? 0) > 0 && <p className="text-red-500 text-sm mt-2">{result.errors!.length} errors</p>}
            </div>
          )}

          {step === 'preview' && summary && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-gray-700">{summary.sheetTotal}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Sheet Rows</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-green-700">{summary.newCount}</div>
                  <div className="text-xs text-green-600 mt-0.5">Not Yet Imported</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-blue-700">{summary.syncedCount}</div>
                  <div className="text-xs text-blue-600 mt-0.5">Already in DB</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-red-600">{summary.dupEntryCount}</div>
                  <div className="text-xs text-red-500 mt-0.5">DB Duplicates</div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mb-4 border-b border-gray-200">
                <button
                  onClick={() => setTab('new')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${tab === 'new' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  🟢 New to Import
                  <span className="ml-1.5 bg-green-100 text-green-700 text-xs rounded-full px-2 py-0.5">{summary.newCount}</span>
                </button>
                <button
                  onClick={() => setTab('duplicates')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${tab === 'duplicates' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  🔴 DB Duplicates
                  <span className="ml-1.5 bg-red-100 text-red-600 text-xs rounded-full px-2 py-0.5">{summary.dupEntryCount} extra</span>
                </button>
              </div>

              {/* New rows tab */}
              {tab === 'new' && (
                summary.newCount === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <div className="text-3xl mb-2">✅</div>
                    All sheet rows are already in the database.
                  </div>
                ) : (
                  <div className="overflow-auto border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2 w-8">
                            <input type="checkbox"
                              checked={readyNewCount === newRows.filter(r => r.partyId && r.qualityId).length && readyNewCount > 0}
                              onChange={e => {
                                if (e.target.checked) setSelectedNew(new Set(newRows.map((_, i) => i).filter(i => newRows[i].partyId && newRows[i].qualityId)))
                                else setSelectedNew(new Set())
                              }}
                            />
                          </th>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">Challan</th>
                          <th className="px-3 py-2 text-left">Party</th>
                          <th className="px-3 py-2 text-left">Quality</th>
                          <th className="px-3 py-2 text-left">Lot No</th>
                          <th className="px-3 py-2 text-right">Than</th>
                          <th className="px-3 py-2 text-right">P.Total</th>
                          <th className="px-3 py-2 text-left">Issue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newRows.map((row, i) => {
                          const isReady = !!(row.partyId && row.qualityId && row.lotNo)
                          return (
                            <tr key={i} className={`border-b last:border-0 ${!isReady ? 'opacity-50' : ''}`}>
                              <td className="px-3 py-1.5">
                                <input type="checkbox" checked={selectedNew.has(i)} disabled={!isReady}
                                  onChange={() => setSelectedNew(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })} />
                              </td>
                              <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{row.date}</td>
                              <td className="px-3 py-1.5 text-gray-600">{row.challanNo ?? '—'}</td>
                              <td className="px-3 py-1.5 font-medium">{row.partyName}</td>
                              <td className="px-3 py-1.5 text-gray-600">{row.qualityName}</td>
                              <td className="px-3 py-1.5 text-indigo-700 font-medium">{row.lotNo}</td>
                              <td className="px-3 py-1.5 text-right font-medium">{row.than}</td>
                              <td className="px-3 py-1.5 text-right text-gray-600">{row.pTotal ?? '—'}</td>
                              <td className="px-3 py-1.5 text-yellow-700 text-[10px]">{row.missingMasters.join(', ')}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {/* DB Duplicates tab */}
              {tab === 'duplicates' && (
                summary.dupEntryCount === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <div className="text-3xl mb-2">✅</div>
                    No duplicate entries found in the database.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                      ⚠ {summary.dupGroupCount} lot(s) have multiple entries for the same Challan + Lot No.
                      The <strong>first (oldest)</strong> entry is kept; extras are pre-selected for deletion.
                    </div>
                    {dbDuplicates.map(group => (
                      <div key={group.key} className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-4 py-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                          <span className="font-semibold text-gray-700">Ch {group.challanNo}</span>
                          <span className="text-indigo-700 font-medium">Lot {group.lotNo}</span>
                          <span className="text-gray-600">{group.partyName}</span>
                          <span className="text-gray-500">{group.qualityName}</span>
                          <span className="ml-auto text-red-500 font-medium">{group.entries.length} copies</span>
                        </div>
                        <table className="w-full text-xs">
                          <thead className="border-b bg-white">
                            <tr>
                              <th className="px-3 py-1.5 text-left w-8">Del?</th>
                              <th className="px-3 py-1.5 text-left">Entry Date</th>
                              <th className="px-3 py-1.5 text-left">Imported At</th>
                              <th className="px-3 py-1.5 text-right">Than</th>
                              <th className="px-3 py-1.5 text-left">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.entries.map((e, idx) => (
                              <tr key={e.id} className={`border-b last:border-0 ${selectedDupIds.has(e.id) ? 'bg-red-50' : 'bg-white'}`}>
                                <td className="px-3 py-1.5">
                                  {idx === 0
                                    ? <span className="text-gray-400">—</span>
                                    : <input type="checkbox" checked={selectedDupIds.has(e.id)}
                                        onChange={() => setSelectedDupIds(prev => { const s = new Set(prev); s.has(e.id) ? s.delete(e.id) : s.add(e.id); return s })} />
                                  }
                                </td>
                                <td className="px-3 py-1.5 text-gray-600">{fmt(e.date)}</td>
                                <td className="px-3 py-1.5 text-gray-400">{fmt(e.createdAt)}</td>
                                <td className="px-3 py-1.5 text-right font-medium">{e.than}</td>
                                <td className="px-3 py-1.5">
                                  {idx === 0
                                    ? <span className="text-green-600 font-semibold text-[10px] px-1.5 py-0.5 bg-green-50 rounded">KEEP</span>
                                    : <span className="text-red-500 font-semibold text-[10px] px-1.5 py-0.5 bg-red-100 rounded">DELETE</span>
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-between items-center gap-3 flex-wrap">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'preview' && tab === 'new' && readyNewCount > 0 && (
            <button onClick={handleImportNew}
              className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
              ✅ Import {readyNewCount} New Rows
            </button>
          )}
          {step === 'preview' && tab === 'duplicates' && selectedDupIds.size > 0 && (
            <button onClick={handleDeleteDups}
              className="bg-red-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-700">
              🗑 Delete {selectedDupIds.size} Duplicate Entries
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
