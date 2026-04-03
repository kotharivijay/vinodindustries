'use client'

import { useState } from 'react'
import Link from 'next/link'
import BackButton from '../../BackButton'

interface NeedsUpdateRow {
  lotNo: string
  than: number | null
  dbWeight: string | null
  dbMtr: number | null
  sheetWeight: number | null
  sheetMtr: number | null
  sheetAvgCut: number | null
}

interface SyncResult {
  sheetRows: number
  matched: number
  notFound: number
  needsUpdate: NeedsUpdateRow[]
  alreadyFilled: number
  notFoundLots: string[]
}

export default function WeightsPage() {
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showNotFound, setShowNotFound] = useState(false)
  const [updateCount, setUpdateCount] = useState<number | null>(null)

  async function handleSync() {
    setLoading(true)
    setError(null)
    setResult(null)
    setSelected(new Set())
    setUpdateCount(null)
    try {
      const res = await fetch('/api/grey/import-weights', { method: 'POST' })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setResult(data)
      // Auto-select all that need update
      setSelected(new Set(data.needsUpdate.map((r: NeedsUpdateRow) => r.lotNo)))
    } catch (e: any) {
      setError(e.message || 'Sync failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate() {
    if (!result || selected.size === 0) return
    setUpdating(true)
    setError(null)
    try {
      const lots = result.needsUpdate
        .filter(r => selected.has(r.lotNo))
        .map(r => ({ lotNo: r.lotNo, weight: r.sheetWeight, grayMtr: r.sheetMtr }))

      const res = await fetch('/api/grey/import-weights', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lots }),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setUpdateCount(data.updated)
      // Remove updated lots from needsUpdate
      setResult(prev => prev ? {
        ...prev,
        needsUpdate: prev.needsUpdate.filter(r => !selected.has(r.lotNo)),
        alreadyFilled: prev.alreadyFilled + selected.size,
      } : null)
      setSelected(new Set())
    } catch (e: any) {
      setError(e.message || 'Update failed')
    } finally {
      setUpdating(false)
    }
  }

  function toggleSelect(lotNo: string) {
    setSelected(prev => {
      const s = new Set(prev)
      if (s.has(lotNo)) s.delete(lotNo)
      else s.add(lotNo)
      return s
    })
  }

  function toggleAll() {
    if (!result) return
    if (selected.size === result.needsUpdate.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(result.needsUpdate.map(r => r.lotNo)))
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <span className="text-2xl">&#x2696;&#xFE0F;</span> Update Weights from Google Sheet
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Import weight (gm/mtr) and gray meter data for lots missing these values
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/grey"
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Back to Grey
          </Link>
          <button
            onClick={handleSync}
            disabled={loading}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Syncing...
              </>
            ) : 'Sync from Sheet'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Update success */}
      {updateCount !== null && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3 text-sm text-green-700 dark:text-green-300">
          Updated {updateCount} lot(s) successfully.
        </div>
      )}

      {/* Summary Cards */}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryCard label="Sheet Rows" value={result.sheetRows} color="blue" />
          <SummaryCard label="Matched" value={result.matched} color="green" />
          <SummaryCard label="Needs Update" value={result.needsUpdate.length} color="yellow" />
          <SummaryCard label="Already Filled" value={result.alreadyFilled} color="gray" />
          <SummaryCard label="Not Found" value={result.notFound} color="red" />
        </div>
      )}

      {/* Needs Update Table */}
      {result && result.needsUpdate.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 gap-2">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              Lots Needing Update ({result.needsUpdate.length})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={toggleAll}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {selected.size === result.needsUpdate.length ? 'Deselect All' : 'Select All'}
              </button>
              <button
                onClick={handleUpdate}
                disabled={updating || selected.size === 0}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {updating ? 'Updating...' : `Update Selected (${selected.size})`}
              </button>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
            {result.needsUpdate.map(row => (
              <div
                key={row.lotNo}
                onClick={() => toggleSelect(row.lotNo)}
                className={`p-3 cursor-pointer ${selected.has(row.lotNo) ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.lotNo)}
                    onChange={() => toggleSelect(row.lotNo)}
                    className="rounded"
                  />
                  <span className="font-mono font-semibold text-sm text-gray-800 dark:text-gray-100">{row.lotNo}</span>
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
                    Missing
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                  <div>Than: <span className="text-gray-800 dark:text-gray-200">{row.than ?? '-'}</span></div>
                  <div>Avg Cut: <span className="text-gray-800 dark:text-gray-200">{row.sheetAvgCut ?? '-'}</span></div>
                  <div>Sheet Wt: <span className="text-green-600 dark:text-green-400 font-medium">{row.sheetWeight ? `${row.sheetWeight}g` : '-'}</span></div>
                  <div>Sheet Mtr: <span className="text-green-600 dark:text-green-400 font-medium">{row.sheetMtr ?? '-'}</span></div>
                  <div>DB Wt: <span className="text-red-500">{row.dbWeight || 'null'}</span></div>
                  <div>DB Mtr: <span className="text-red-500">{row.dbMtr ?? 'null'}</span></div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === result.needsUpdate.length}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-4 py-2">Lot No</th>
                  <th className="px-4 py-2 text-right">Than</th>
                  <th className="px-4 py-2 text-right">Sheet Weight</th>
                  <th className="px-4 py-2 text-right">Sheet Mtr</th>
                  <th className="px-4 py-2 text-right">Avg Cut</th>
                  <th className="px-4 py-2 text-right">DB Weight</th>
                  <th className="px-4 py-2 text-right">DB Mtr</th>
                  <th className="px-4 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {result.needsUpdate.map(row => (
                  <tr
                    key={row.lotNo}
                    onClick={() => toggleSelect(row.lotNo)}
                    className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                      selected.has(row.lotNo) ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                    }`}
                  >
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.lotNo)}
                        onChange={() => toggleSelect(row.lotNo)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-2 font-mono font-semibold text-gray-800 dark:text-gray-100">{row.lotNo}</td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{row.than ?? '-'}</td>
                    <td className="px-4 py-2 text-right font-medium text-green-600 dark:text-green-400">{row.sheetWeight ? `${row.sheetWeight}g` : '-'}</td>
                    <td className="px-4 py-2 text-right font-medium text-green-600 dark:text-green-400">{row.sheetMtr ?? '-'}</td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{row.sheetAvgCut ?? '-'}</td>
                    <td className="px-4 py-2 text-right text-red-500">{row.dbWeight || 'null'}</td>
                    <td className="px-4 py-2 text-right text-red-500">{row.dbMtr ?? 'null'}</td>
                    <td className="px-4 py-2 text-center">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
                        Missing
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Already filled message */}
      {result && result.needsUpdate.length === 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-6 text-center mb-6">
          <p className="text-green-700 dark:text-green-300 font-medium">All matched lots already have weight and meter data filled.</p>
        </div>
      )}

      {/* Not Found Section */}
      {result && result.notFoundLots.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setShowNotFound(!showNotFound)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              Not Found in DB ({result.notFoundLots.length} lots)
            </h2>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showNotFound ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showNotFound && (
            <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700 pt-3">
              <div className="flex flex-wrap gap-2">
                {result.notFoundLots.map(lot => (
                  <span
                    key={lot}
                    className="px-2 py-1 text-xs font-mono bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded border border-red-200 dark:border-red-800"
                  >
                    {lot}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Initial state */}
      {!result && !loading && !error && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 px-6 py-12 text-center">
          <p className="text-4xl mb-3">&#x2696;&#xFE0F;</p>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Click &ldquo;Sync from Sheet&rdquo; to fetch weight and meter data from the INWERD GRAY Google Sheet
            and compare with the database.
          </p>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300',
    gray: 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300',
    red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 ${colors[color] || colors.gray}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}
