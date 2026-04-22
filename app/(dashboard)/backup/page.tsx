'use client'

import { useState } from 'react'
import BackButton from '../BackButton'

interface BackupResult {
  ok?: boolean
  error?: string
  durationMs?: number
  totalRows?: number
  tables?: Record<string, { rows: number; ms: number }>
}

export default function BackupPage() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BackupResult | null>(null)

  async function runBackup() {
    if (!confirm('Copy all production data to the Neon backup DB now? Existing Neon data will be replaced with a fresh snapshot.')) return
    setRunning(true); setResult(null)
    try {
      const res = await fetch('/api/backup/neon', { method: 'POST' })
      const data = await res.json()
      setResult(data)
    } catch (e: any) {
      setResult({ error: e?.message || 'Network error' })
    }
    setRunning(false)
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Database Backup</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Mirror production tables to Neon. Nightly cron runs automatically; hit the button for an on-demand snapshot.</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 mb-4">
        <button
          onClick={runBackup}
          disabled={running}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition"
        >
          {running ? 'Backing up…' : 'Run Backup Now'}
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          Reads Supabase tables (Party, Quality, Grey, Despatch, Dyeing, Fold, Finish, FR, Packing, OB, DeleteLog) and copies to Neon.
        </p>
      </div>

      {result && (
        <div className={`rounded-xl border shadow-sm p-5 ${result.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
          {result.ok ? (
            <>
              <p className="text-sm font-semibold text-green-800 dark:text-green-200">
                ✓ Backup complete — {result.totalRows?.toLocaleString()} rows in {((result.durationMs ?? 0) / 1000).toFixed(1)}s
              </p>
              {result.tables && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
                  {Object.entries(result.tables).map(([table, stat]) => (
                    <div key={table} className="flex justify-between">
                      <span className="truncate">{table}</span>
                      <span className="font-medium ml-2">{stat.rows}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">✗ {result.error}</p>
          )}
        </div>
      )}
    </div>
  )
}
