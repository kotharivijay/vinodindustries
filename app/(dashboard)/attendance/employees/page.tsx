'use client'

import { useMemo, useState, useEffect } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (u: string) => fetch(u).then(r => r.json())

interface Employee {
  id: number
  petpoojaEmpId: number
  code: string | null
  name: string
  department: string | null
  designation: string | null
  status: 'active' | 'left'
  leftDate: string | null
  notes: string | null
  updatedAt: string
}

type Filter = 'all' | 'active' | 'left'

export default function AttendanceEmployeesPage() {
  const { data, mutate, isLoading, isValidating } = useSWR<{ employees: Employee[]; tokenError?: string }>(
    '/api/attendance/employees', fetcher,
  )
  const employees = data?.employees || []
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [updating, setUpdating] = useState<number | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)

  // Mark a successful sync the moment fresh data lands
  useEffect(() => {
    if (data && !data.tokenError) setLastSyncAt(new Date())
  }, [data])

  function fmtTime(d: Date) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  async function toggleStatus(emp: Employee) {
    const next = emp.status === 'active' ? 'left' : 'active'
    const confirmMsg = next === 'left'
      ? `Mark "${emp.name}" as LEFT the job?\nThey'll stop appearing in the No Punch list.`
      : `Mark "${emp.name}" as ACTIVE again?`
    if (!confirm(confirmMsg)) return
    setUpdating(emp.petpoojaEmpId)
    try {
      await fetch('/api/attendance/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ petpoojaEmpId: emp.petpoojaEmpId, status: next }),
      })
      mutate()
    } finally { setUpdating(null) }
  }

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim()
    return employees.filter(e => {
      if (filter !== 'all' && e.status !== filter) return false
      if (!q) return true
      return e.name.toLowerCase().includes(q)
        || (e.code || '').toLowerCase().includes(q)
        || (e.department || '').toLowerCase().includes(q)
        || (e.designation || '').toLowerCase().includes(q)
    })
  }, [employees, filter, search])

  const counts = useMemo(() => ({
    all: employees.length,
    active: employees.filter(e => e.status === 'active').length,
    left: employees.filter(e => e.status === 'left').length,
  }), [employees])

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Employees</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Tag employees who have left so they stop appearing in the No Punch list.</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            {isValidating
              ? '⏳ Syncing from Petpooja…'
              : lastSyncAt
                ? `✓ ${employees.length} employees · last sync ${fmtTime(lastSyncAt)}`
                : '—'}
          </p>
        </div>
        <button onClick={() => mutate()} disabled={isValidating}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          {isValidating ? '⏳ Syncing…' : '🔄 Sync from Petpooja'}
        </button>
      </div>

      {data?.tokenError && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 mb-4 text-xs text-amber-700 dark:text-amber-300">
          {data.tokenError} — showing stored rows only. New employees won&apos;t sync until token is captured.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(['all', 'active', 'left'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === f
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>
            {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Left'} <span className="opacity-70">({counts[f]})</span>
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code, department…"
          className="flex-1 min-w-[240px] px-3 py-1.5 rounded-lg text-xs border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600" />
        <span className="text-xs text-gray-400">{visible.length} shown</span>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-left">Designation</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Left on</th>
                <th className="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {visible.map(e => (
                <tr key={e.id} className={e.status === 'left' ? 'opacity-60' : ''}>
                  <td className="px-3 py-2 text-gray-500">{e.code || e.petpoojaEmpId}</td>
                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{e.name}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{e.department || '—'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{e.designation || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${e.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-400">{e.leftDate ? new Date(e.leftDate).toLocaleDateString('en-IN') : '—'}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleStatus(e)} disabled={updating === e.petpoojaEmpId}
                      className={`text-[10px] px-2 py-1 rounded font-medium ${e.status === 'active'
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800 hover:bg-red-100'
                        : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-300 border border-green-200 dark:border-green-800 hover:bg-green-100'} disabled:opacity-50`}>
                      {updating === e.petpoojaEmpId ? '…' : e.status === 'active' ? 'Mark Left' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No employees match filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
