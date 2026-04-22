'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import BackButton from '../BackButton'

interface LogRow {
  id: number
  module: string
  slipType: string | null
  slipNo: string | null
  lotNo: string | null
  than: number | null
  userEmail: string
  deletedAt: string
  recordId: number | null
  details: any
}

const fetcher = (u: string) => fetch(u).then(r => r.json())

const MODULES = ['', 'grey', 'despatch', 'finish', 'dyeing', 'fold', 'folding-receipt']
const MODULE_STYLE: Record<string, string> = {
  grey:              'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  despatch:          'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  finish:            'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  dyeing:            'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  fold:              'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'folding-receipt': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

export default function DeleteLogPage() {
  const [module, setModule] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const qs = new URLSearchParams()
  if (module) qs.set('module', module)
  if (debouncedQ) qs.set('q', debouncedQ)
  const url = `/api/delete-log${qs.toString() ? '?' + qs : ''}`

  const { data: logs = [], isLoading } = useSWR<LogRow[]>(url, fetcher, { revalidateOnFocus: false })

  const fmt = (s: string) => new Date(s).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Delete Log</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Audit trail of every deletion across modules.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={module} onChange={e => setModule(e.target.value)}
          className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
          {MODULES.map(m => <option key={m} value={m}>{m || 'All modules'}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search lot / slip / user email"
          className="flex-1 min-w-[240px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
        <span className="text-xs text-gray-400 self-center ml-auto">{logs.length} entries</span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-gray-400">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No deletions logged yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">When</th>
                  <th className="px-3 py-2 text-left font-semibold">Module</th>
                  <th className="px-3 py-2 text-left font-semibold">Slip</th>
                  <th className="px-3 py-2 text-left font-semibold">Lot</th>
                  <th className="px-3 py-2 text-right font-semibold">Than</th>
                  <th className="px-3 py-2 text-left font-semibold">User</th>
                  <th className="px-3 py-2 text-right font-semibold">Rec ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-700 dark:text-gray-200">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmt(l.deletedAt)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${MODULE_STYLE[l.module] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                        {l.module}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {l.slipType && <span className="text-gray-400 text-xs mr-1">{l.slipType}</span>}
                      <span className="font-medium">{l.slipNo ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-indigo-600 dark:text-indigo-400 max-w-xs truncate" title={l.lotNo ?? ''}>{l.lotNo ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{l.than ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{l.userEmail}</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-400">{l.recordId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
