'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import BackButton from '../BackButton'

const fetcher = (u: string) => fetch(u).then(r => r.json())

interface Branch { branch_id: number; branch_name: string; organization_id?: number }
interface AttendanceRow {
  emp_id?: number | string
  emp_code?: number | string
  employee_name?: string
  name?: string
  designation?: string
  department?: string
  punch_in?: string
  punch_out?: string
  in_time?: string
  out_time?: string
  working_hrs?: string | number
  working_hours?: string | number
  break?: string | number
  break_hrs?: string | number
  status?: string
}

function todayISO() { return new Date().toISOString().slice(0, 10) }
function yesterdayISO() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function statusColor(s: string): string {
  const v = (s || '').toUpperCase()
  if (v === 'FD' || v.includes('PRESENT') || v === 'P') return 'bg-green-600 text-white'
  if (v === 'HD' || v.includes('HALF')) return 'bg-amber-500 text-white'
  if (v === 'ABSENT' || v === 'A') return 'bg-red-600 text-white'
  return 'bg-gray-500 text-white'
}

function classify(s: string): 'FD' | 'HD' | 'ABSENT' | 'OTHER' {
  const v = (s || '').toUpperCase()
  if (v === 'FD' || v.includes('PRESENT') || v === 'P') return 'FD'
  if (v === 'HD' || v.includes('HALF')) return 'HD'
  if (v === 'ABSENT' || v === 'A') return 'ABSENT'
  return 'OTHER'
}

function normalizeRow(r: any): AttendanceRow & { _status: string; _name: string; _id: string; _in: string; _out: string; _hrs: string; _brk: string; _desig: string } {
  const name = r.employee_name || r.name || r.emp_name || '—'
  const status = r.status || r.attendance_status || '—'
  const id = String(r.emp_code ?? r.emp_id ?? r.employee_id ?? '—')
  const pin = r.punch_in || r.in_time || r.first_in || '-'
  const pout = r.punch_out || r.out_time || r.last_out || '-'
  const hrs = r.working_hrs ?? r.working_hours ?? r.total_hours ?? '-'
  const brk = r.break ?? r.break_hrs ?? r.break_time ?? '-'
  const desig = r.designation || r.department || '—'
  return { ...r, _status: status, _name: name, _id: id, _in: pin, _out: pout, _hrs: String(hrs), _brk: String(brk), _desig: desig }
}

export default function AttendancePage() {
  const [date, setDate] = useState(todayISO())
  const [selectedBranches, setSelectedBranches] = useState<number[]>([])

  // Token status
  const { data: tokenInfo, mutate: refetchToken } = useSWR<{ present: boolean; expired?: boolean; daysLeft?: number; orgName?: string | null; expiresAt?: string }>(
    '/api/attendance/save-token', fetcher,
  )

  // Branches (only if token ready)
  const { data: branchData, error: branchErr } = useSWR<any>(
    tokenInfo?.present ? '/api/attendance/branches' : null, fetcher,
  )
  const branches: Branch[] = useMemo(() => {
    if (!branchData) return []
    const raw = branchData?.data ?? branchData?.organizations ?? branchData?.branches ?? []
    if (!Array.isArray(raw)) return []
    return raw.map((b: any) => ({
      branch_id: Number(b.branch_id ?? b.organization_id ?? b.id),
      branch_name: b.branch_name || b.organization_name || b.name || `Branch ${b.branch_id ?? b.id}`,
      organization_id: b.organization_id,
    })).filter(b => Number.isFinite(b.branch_id))
  }, [branchData])

  // Default-select branches whose name contains "vinod industries"
  useEffect(() => {
    if (branches.length === 0 || selectedBranches.length > 0) return
    const def = branches.filter(b => /vinod\s+industries/i.test(b.branch_name))
    setSelectedBranches(def.length > 0 ? def.map(b => b.branch_id) : [branches[0].branch_id])
  }, [branches, selectedBranches.length])

  // Daily attendance
  const dailyKey = tokenInfo?.present && selectedBranches.length > 0
    ? `/api/attendance/daily?date=${date}&branches=${selectedBranches.join(',')}` : null
  const { data: daily, isLoading: dailyLoading, mutate: refetchDaily } = useSWR<any>(dailyKey, fetcher)

  const perBranchData = useMemo(() => {
    const rows: { branch: Branch; rows: ReturnType<typeof normalizeRow>[]; summary: { total: number; fd: number; hd: number; absent: number } }[] = []
    if (!daily?.results) return rows
    for (const r of daily.results) {
      const br = branches.find(b => b.branch_id === r.branchId) || { branch_id: r.branchId, branch_name: `Branch ${r.branchId}` } as Branch
      const rawRows: any[] = Array.isArray(r.data) ? r.data : r.data?.data || r.data?.rows || r.data?.attendance_data || []
      const normalized = rawRows.map(normalizeRow)
      const summary = { total: normalized.length, fd: 0, hd: 0, absent: 0 }
      for (const n of normalized) {
        const c = classify(n._status)
        if (c === 'FD') summary.fd++
        else if (c === 'HD') summary.hd++
        else if (c === 'ABSENT') summary.absent++
      }
      rows.push({ branch: br, rows: normalized, summary })
    }
    return rows
  }, [daily, branches])

  function shareText() {
    const lines: string[] = []
    lines.push(`📋 *Attendance — ${new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: '2-digit' })}*\n`)
    for (const b of perBranchData) {
      const pct = b.summary.total ? Math.round((b.summary.fd / b.summary.total) * 100) : 0
      lines.push(`*${b.branch.branch_name}* | Total ${b.summary.total} · Present ${b.summary.fd} · HD ${b.summary.hd} · Absent ${b.summary.absent} (${pct}%)`)
      for (const r of b.rows) {
        lines.push(`  ${r._id.padEnd(3)} ${r._name} · ${r._status}`)
      }
      lines.push('')
    }
    const text = lines.join('\n')
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
  }

  function shareJPG() {
    // Simple: print view → user can save as image
    window.print()
  }

  const disabled = !tokenInfo?.present || tokenInfo.expired

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Attendance</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Petpooja Payroll · {tokenInfo?.orgName || '—'}</p>
        </div>
      </div>

      {/* Token status */}
      {!tokenInfo?.present && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">⚠️ Petpooja token not captured yet</p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
            Open <a href="/attendance/token" className="underline">/attendance/token</a> to paste your token, or use the DevTools snippet.
          </p>
        </div>
      )}
      {tokenInfo?.present && tokenInfo.expired && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">Token expired — re-capture at <a href="/attendance/token" className="underline">/attendance/token</a></p>
        </div>
      )}
      {tokenInfo?.present && !tokenInfo.expired && tokenInfo.daysLeft != null && tokenInfo.daysLeft <= 7 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3 mb-4 text-xs text-yellow-700 dark:text-yellow-300">
          Token expires in {tokenInfo.daysLeft} day(s). Re-capture at <a href="/attendance/token" className="underline">/attendance/token</a> to avoid disruption.
        </div>
      )}

      {/* Date selector */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setDate(todayISO())}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${date === todayISO() ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>
          Today
        </button>
        <button onClick={() => setDate(yesterdayISO())}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${date === yesterdayISO() ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>
          Yesterday
        </button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600" />
        <button onClick={() => { refetchDaily(); refetchToken() }} disabled={disabled}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50">
          🔄 Refresh
        </button>
        <div className="ml-auto flex gap-2">
          <button onClick={shareText} disabled={disabled || perBranchData.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white disabled:opacity-50">
            📋 Share Text
          </button>
          <button onClick={shareJPG} disabled={disabled || perBranchData.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white disabled:opacity-50">
            📸 Print / Save
          </button>
        </div>
      </div>

      {/* Branch selector */}
      {branches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">Branches:</span>
          {branches.map(b => {
            const isSel = selectedBranches.includes(b.branch_id)
            return (
              <button key={b.branch_id} onClick={() =>
                setSelectedBranches(prev => prev.includes(b.branch_id) ? prev.filter(x => x !== b.branch_id) : [...prev, b.branch_id])
              }
                className={`px-3 py-1 rounded-full text-xs font-medium border ${isSel ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600'}`}>
                {b.branch_name}
              </button>
            )
          })}
        </div>
      )}
      {branchErr && <p className="text-xs text-red-500 mb-3">Branch load failed: {String(branchErr)}</p>}

      {/* Daily report */}
      {disabled ? null : dailyLoading ? (
        <div className="p-10 text-center text-gray-400">Loading…</div>
      ) : (
        <div id="attendance-print-root" className="space-y-4">
          {perBranchData.length === 0 && <div className="p-10 text-center text-gray-400">No branches selected or no data.</div>}
          {perBranchData.map(b => {
            const pct = b.summary.total ? Math.round((b.summary.fd / b.summary.total) * 100) : 0
            return (
              <div key={b.branch.branch_id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="bg-emerald-700 text-white px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-bold">{b.branch.branch_name}</span>
                  <span>|</span>
                  <span>Total: {b.summary.total}</span>
                  <span>Present: {b.summary.fd}</span>
                  <span>Half-Day: {b.summary.hd}</span>
                  <span>Absent: {b.summary.absent}</span>
                  <span className="ml-auto text-xs opacity-90">({pct}% attendance)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-300">
                      <tr>
                        <th className="px-2 py-1.5 text-left">ID</th>
                        <th className="px-2 py-1.5 text-left">Name</th>
                        <th className="px-2 py-1.5 text-left">Designation</th>
                        <th className="px-2 py-1.5 text-left">Punch In</th>
                        <th className="px-2 py-1.5 text-left">Punch Out</th>
                        <th className="px-2 py-1.5 text-left">Working Hrs</th>
                        <th className="px-2 py-1.5 text-left">Break</th>
                        <th className="px-2 py-1.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {b.rows.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                          <td className="px-2 py-1 text-gray-500">{r._id}</td>
                          <td className="px-2 py-1 font-medium text-gray-800 dark:text-gray-100">{r._name}</td>
                          <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{r._desig}</td>
                          <td className="px-2 py-1">{r._in}</td>
                          <td className="px-2 py-1">{r._out}</td>
                          <td className="px-2 py-1">{r._hrs}</td>
                          <td className="px-2 py-1">{r._brk}</td>
                          <td className="px-2 py-1">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusColor(r._status)}`}>{r._status}</span>
                          </td>
                        </tr>
                      ))}
                      {b.rows.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-gray-400">No rows</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
