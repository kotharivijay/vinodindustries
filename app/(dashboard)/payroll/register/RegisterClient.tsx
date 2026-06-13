'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Row = {
  staffId: string
  sn: number
  code: string
  name: string
  department: string | null
  salary: number
  perDay: number
  days: number
  amount: number
  status: string
  autoStatus: string
  statusOverridden: boolean
  inRegister: boolean
  registerGroup: string | null
}

type RegisterResponse = {
  monthKey: string
  monthDays: number
  rows: Row[]
  count: number
  totals: { salary: number; amount: number; reg: number }
}

type SortKey = 'status' | 'sn' | 'code' | 'name' | 'department' | 'salary' | 'perDay' | 'days' | 'amount' | 'registerGroup'
const NUMERIC_KEYS: SortKey[] = ['sn', 'code', 'salary', 'perDay', 'days', 'amount']

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function statusClasses(s: string): string {
  if (/delete/i.test(s)) return 'text-red-700 bg-red-100 dark:bg-red-900/30'
  if (/new/i.test(s)) return 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30'
  if (/inc/i.test(s)) return 'text-amber-700 bg-amber-100 dark:bg-amber-900/30'
  return 'text-gray-600 bg-gray-100 dark:bg-gray-800'
}

export default function RegisterClient() {
  const [month, setMonth] = useState(currentMonthKey())
  const [data, setData] = useState<RegisterResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<string | null>(null) // staffId being edited
  const [editValue, setEditValue] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [replace, setReplace] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filter, setFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payroll/register?month=${month}`)
      const json = await res.json()
      if (res.ok) setData(json)
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => { load() }, [load])

  async function saveStatus(staffId: string, value: string | null) {
    await fetch('/api/payroll/register', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId, month, registerStatus: value }),
    })
    setEditing(null)
    load()
  }

  async function runImport() {
    if (!pasteText.trim()) { alert('Paste the register rows first'); return }
    setImporting(true); setImportMsg(null)
    try {
      const res = await fetch('/api/payroll/register/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText, month, replace }),
      })
      const json = await res.json()
      if (!res.ok) { setImportMsg(json.error || 'Import failed'); return }
      setImportMsg(`${json.marked} marked Reg${json.notFound ? ` · ${json.notFound} code(s) not found` : ''}${json.unparsed ? ` · ${json.unparsed} unparsed` : ''}`)
      setPasteText('')
      load()
    } finally {
      setImporting(false)
    }
  }

  const exportUrl = (format: 'salary' | 'pf', group?: string) =>
    `/api/payroll/register/export?month=${month}&format=${format}${group ? `&group=${group}` : ''}`

  const rows = data?.rows || []

  const groupedRows = useMemo(() => {
    if (groupFilter === 'unassigned') return rows.filter((r) => !r.registerGroup)
    if (!groupFilter) return rows
    return rows.filter((r) => r.registerGroup === groupFilter)
  }, [rows, groupFilter])

  const summary = useMemo(() => {
    const count = groupedRows.length
    let salary = 0, amount = 0, reg = 0
    groupedRows.forEach((r) => {
      salary += r.salary
      amount += r.amount || 0
      if (r.inRegister) reg++
    })
    return { count, salary, amount, reg }
  }, [groupedRows])

  const fmt = (n: number | null) => (n == null ? '' : n.toLocaleString('en-IN'))

  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter(Boolean))).sort() as string[],
    [rows]
  )

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }

  // Client-side filter + sort over the loaded rows. Default (no sortKey)
  // keeps the server's register order (registerSn).
  const view = useMemo(() => {
    let v = groupedRows
    const q = filter.trim().toLowerCase()
    if (q) v = v.filter((r) =>
      r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) ||
      (r.department || '').toLowerCase().includes(q) || r.status.toLowerCase().includes(q))
    if (deptFilter) v = v.filter((r) => (r.department || '') === deptFilter)
    if (sortKey) {
      const numeric = NUMERIC_KEYS.includes(sortKey)
      v = [...v].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey]
        const cmp = numeric
          ? (Number(av) || 0) - (Number(bv) || 0)
          : String(av ?? '').localeCompare(String(bv ?? ''))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return v
  }, [rows, filter, deptFilter, sortKey, sortDir])

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    if (!y || !m) return month
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }, [month])

  // Sortable header cell — click to sort by this column, toggles asc/desc.
  const thCell = (label: string, k: SortKey, align: 'left' | 'right' = 'left') => (
    <th onClick={() => toggleSort(k)}
      className={`px-2 py-2 cursor-pointer select-none whitespace-nowrap hover:text-gray-700 dark:hover:text-gray-300 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {label}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-xl md:text-2xl font-bold">Payroll · Salary Register</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800" />
          <button onClick={() => setShowImport((v) => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer">
            {showImport ? '✕ Close' : '📋 Paste Register'}
          </button>
          <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1 bg-gray-50 dark:bg-gray-800/40">
            <span className="text-[10px] text-gray-500 font-medium px-1 uppercase tracking-wider">Salary:</span>
            <a href={exportUrl('salary')} className="text-[10px] font-semibold px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white">All</a>
            <a href={exportUrl('salary', 'KSI-1')} className="text-[10px] font-semibold px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white">KSI-1</a>
            <a href={exportUrl('salary', 'KSI-2')} className="text-[10px] font-semibold px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white">KSI-2</a>
          </div>
          <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1 bg-gray-50 dark:bg-gray-800/40">
            <span className="text-[10px] text-gray-500 font-medium px-1 uppercase tracking-wider">PF:</span>
            <a href={exportUrl('pf')} className="text-[10px] font-semibold px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white">All</a>
            <a href={exportUrl('pf', 'KSI-1')} className="text-[10px] font-semibold px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white">KSI-1</a>
            <a href={exportUrl('pf', 'KSI-2')} className="text-[10px] font-semibold px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white">KSI-2</a>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Month</p><p className="text-lg font-bold">{monthLabel}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Staff in register</p><p className="text-xl font-bold">{data ? summary.count : '—'}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">On PF (Reg)</p><p className="text-xl font-bold text-blue-600">{data ? summary.reg : '—'}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Total Amount</p><p className="text-xl font-bold">₹{data ? fmt(summary.amount) : '—'}</p></div>
      </div>

      {showImport && (
        <div className="card p-4 mb-4 border-2 border-indigo-200 dark:border-indigo-800">
          <h2 className="text-sm font-semibold mb-1">Mark Reg by code (codes only — wages unchanged)</h2>
          <p className="text-xs text-gray-500 mb-2">
            Paste the register (or just a list of codes). Every <strong>code</strong> that matches an existing staff gets the
            <strong> Reg</strong> badge + sheet order. Salary, name, department and wages are <strong>not</strong> changed; unknown codes are reported, never created.
          </p>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6}
            placeholder={'\t1\t1002\tDanaram S/O Rama Ram\tetp\t33000\t1100\t\t\nsalary inc\t34\t1398\tPRAKASH S/O CHUNARAM\tETP\t31000\t1033\t\t'}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono bg-white dark:bg-gray-800" />
          <div className="flex flex-wrap justify-between items-center gap-2 mt-2">
            <label className="text-xs flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Replace — clear Reg on codes not in this paste
            </label>
            <div className="flex gap-2">
              <button onClick={() => { setPasteText(''); setImportMsg(null) }} className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600">Clear</button>
              <button onClick={runImport} disabled={importing} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white">
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
          {importMsg && <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">{importMsg}</p>}
        </div>
      )}

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter code / name / dept / status"
          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800" />
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800">
          <option value="">All Groups</option>
          <option value="KSI-1">KSI-1</option>
          <option value="KSI-2">KSI-2</option>
          <option value="unassigned">— Unassigned —</option>
        </select>
        {(filter || deptFilter || groupFilter || sortKey) && (
          <button onClick={() => { setFilter(''); setDeptFilter(''); setGroupFilter(''); setSortKey(null) }}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600">Reset</button>
        )}
        <span className="text-xs text-gray-500 ml-auto">{view.length} of {rows.length}</span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-gray-500">
                {thCell('Status', 'status')}
                {thCell('Sn', 'sn', 'right')}
                {thCell('Code', 'code')}
                {thCell('Employee Name', 'name')}
                {thCell('Department', 'department')}
                {thCell('Group', 'registerGroup')}
                {thCell('Salary', 'salary', 'right')}
                {thCell('Perday', 'perDay', 'right')}
                {thCell('Day', 'days', 'right')}
                {thCell('Amount', 'amount', 'right')}
              </tr>
            </thead>
            <tbody>
              {loading && (<tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>)}
              {!loading && view.length === 0 && (<tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{rows.length === 0 ? "No staff in this month's register." : 'No rows match the filter.'}</td></tr>)}
              {!loading && view.map((r) => (
                <tr key={r.staffId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1.5">
                    {editing === r.staffId ? (
                      <span className="flex items-center gap-1">
                        <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveStatus(r.staffId, editValue); if (e.key === 'Escape') setEditing(null) }}
                          placeholder={r.autoStatus || '(blank)'}
                          className="w-28 px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-800" />
                        <button onClick={() => saveStatus(r.staffId, editValue)} className="text-emerald-600 text-xs" title="Save">✓</button>
                        <button onClick={() => saveStatus(r.staffId, null)} className="text-gray-400 text-xs" title="Reset to auto">⟲</button>
                      </span>
                    ) : (
                      <button onClick={() => { setEditing(r.staffId); setEditValue(r.status) }}
                        className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${r.status ? statusClasses(r.status) : 'text-gray-300 hover:text-gray-500'}`}
                        title={r.statusOverridden ? 'Manual override — click to edit' : (r.autoStatus ? 'Auto — click to override' : 'Click to add')}>
                        {r.status || '—'}{r.statusOverridden && <span className="ml-0.5 text-[8px] align-top">✎</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-400 text-xs">{r.sn}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-gray-600 dark:text-gray-400">{r.code}</td>
                  <td className="px-2 py-1.5 font-medium">
                    {r.name}
                    {r.inRegister && <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-semibold align-middle">Reg</span>}
                  </td>
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 text-xs">{r.department || '—'}</td>
                  <td className="px-2 py-1.5 text-xs">
                    {r.registerGroup ? <span className="badge badge-gray">{r.registerGroup}</span> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold">{fmt(r.salary)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-400">{fmt(r.perDay)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-400">{r.days ?? ''}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{fmt(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        STATUS auto-fills <span className="text-emerald-600">new</span> (999x code, first month) ·
        <span className="text-amber-600"> salary inc</span> (raise this month) ·
        <span className="text-red-600"> deleted</span> (inactive next month). Click any STATUS cell to override; ⟲ resets to auto.
        Perday / Day / Amount come from the posted wage entry (Amount = calculated wage).
      </p>
    </div>
  )
}
