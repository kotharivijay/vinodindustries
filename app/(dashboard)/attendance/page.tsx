'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import BackButton from '../BackButton'

const fetcher = (u: string) => fetch(u).then(r => r.json())

interface PunchInfo { time: string; kind: 'IN' | 'OUT' }

interface AttendanceRow {
  id: string | number
  petpoojaEmpId: number | null
  name: string
  designation: string
  punchIn: string
  punchOut: string
  workingHrs: string
  break: string
  status: string
  isLeft?: boolean
  leaveName?: string | null
  holidayName?: string | null
  punches?: PunchInfo[]
}

/** Pair punches into [in,out] sessions. Trailing IN with no OUT becomes [in,null]. */
function pairPunches(punches: PunchInfo[]): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = []
  for (let i = 0; i < punches.length; i += 2) {
    const a = punches[i]
    const b = punches[i + 1]
    out.push([a.time, b ? b.time : null])
  }
  return out
}

/** "09:18 AM" → "9:18", "07:34 PM" → "19:34" — short 24h for WhatsApp. */
function to24h(s: string | null | undefined): string {
  if (!s) return '-'
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/)
  if (!m) return s.trim()
  let h = parseInt(m[1], 10)
  const min = m[2]
  const ap = (m[3] || '').toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return `${h}:${min}`
}

/** "9h 13m" / "9.21" / "9:13" → "9h13m". Cosmetic only. */
function shortHrs(s: string | null | undefined): string {
  if (!s || s === '-') return ''
  return s.replace(/\s+/g, '').replace(/h$/i, 'h0m')
}

interface DeptGroup {
  department: string
  total: number
  present: number
  halfDay: number
  absent: number
  attendancePct: number
  rows: AttendanceRow[]
}

interface DailyResponse {
  date: string
  orgName: string
  orgId: number
  groups: DeptGroup[]
  totalRows: number
}

interface SharePage {
  index: number
  total: number
  deptLabel: string
  totals: { total: number; punched: number; noPunch: number }
  rows: AttendanceRow[]
  noPunch?: AttendanceRow[]
}

function SharePageCard({ page, dateLabel }: { page: SharePage; dateLabel: string }) {
  return (
    <div id={`attendance-img-page-${page.index - 1}`}
      style={{ width: '720px', fontFamily: 'system-ui, -apple-system, sans-serif' }}
      className="bg-white text-gray-900 p-5">
      <div className="border-b-2 border-emerald-700 pb-2 mb-3">
        <div className="text-xl font-bold">📋 Attendance · {dateLabel}</div>
        <div className="text-xs text-gray-600 mt-0.5">{page.deptLabel} · Page {page.index}/{page.total}</div>
        <div className="text-xs mt-1 flex gap-3">
          <span className="font-bold text-green-700">✅ Punched {page.totals.punched}</span>
          <span className="font-bold text-red-700">❌ No Punch {page.totals.noPunch}</span>
          <span className="text-gray-700">📊 {page.totals.punched}/{page.totals.total}</span>
        </div>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-emerald-700 text-white">
            <th className="px-2 py-1.5 text-left">ID</th>
            <th className="px-2 py-1.5 text-left">Name</th>
            <th className="px-2 py-1.5 text-left">Punches</th>
            <th className="px-2 py-1.5 text-right">Hrs</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-2 py-1.5 align-top text-black font-semibold border-b border-gray-200">{r.id}</td>
              <td className="px-2 py-1.5 align-top font-bold text-black border-b border-gray-200">{r.name}</td>
              <td className="px-2 py-1.5 align-top border-b border-gray-200">
                {r.punches && r.punches.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {r.punches.map((p, pi) => (
                      <span key={pi}
                        style={{ fontFamily: 'ui-monospace, monospace' }}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.kind === 'IN'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-orange-100 text-orange-800'}`}>
                        {p.kind} {p.time}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-500">{r.punchIn} → {r.punchOut}</span>
                )}
              </td>
              <td className="px-2 py-1.5 align-top text-right font-mono font-bold text-black border-b border-gray-200">{r.workingHrs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {page.noPunch && page.noPunch.length > 0 && (
        <div className="mt-4 pt-3 border-t-2 border-red-300">
          <div className="text-sm font-bold text-red-700 mb-1.5">❌ No Punch ({page.noPunch.length})</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
            {page.noPunch.map((r, i) => (
              <div key={i}>• <span className="font-bold text-black">{r.name}</span> <span className="text-gray-600">({r.id})</span></div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
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
  if (v.includes('LEAVE')) return 'bg-purple-500 text-white'
  if (v.includes('HOLIDAY') || v.includes('WO')) return 'bg-gray-500 text-white'
  return 'bg-gray-400 text-white'
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: '2-digit' })
}

export default function AttendancePage() {
  const [date, setDate] = useState(todayISO())
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set())

  const { data: tokenInfo, mutate: refetchToken } = useSWR<{ present: boolean; expired?: boolean; daysLeft?: number; orgName?: string | null; expiresAt?: string }>(
    '/api/attendance/save-token', fetcher,
  )

  const dailyKey = tokenInfo?.present && !tokenInfo.expired ? `/api/attendance/daily?date=${date}` : null
  const { data: daily, isLoading: dailyLoading, mutate: refetchDaily } = useSWR<DailyResponse>(dailyKey, fetcher)

  const allDepts = daily?.groups?.map(g => g.department) || []

  // Default-select: Vinod Industries first; else all
  useEffect(() => {
    if (allDepts.length === 0 || selectedDepts.size > 0) return
    const defaults = allDepts.filter(d => /vinod\s+industries/i.test(d))
    setSelectedDepts(new Set(defaults.length > 0 ? defaults : allDepts))
  }, [allDepts.join('|')])

  const visibleGroups = useMemo(
    () => (daily?.groups || []).filter(g => selectedDepts.has(g.department)),
    [daily, selectedDepts],
  )

  function toggleDept(d: string) {
    setSelectedDepts(prev => {
      const n = new Set(prev)
      if (n.has(d)) n.delete(d); else n.add(d)
      return n
    })
  }

  function buildShareText() {
    const lines: string[] = []
    let grandTotal = 0, grandPunched = 0, grandNoPunch = 0
    // Compute totals first for the header
    for (const g of visibleGroups) {
      const active = g.rows.filter(r => !r.isLeft)
      grandTotal += active.length
      grandPunched += active.filter(r => r.punchIn && r.punchIn !== '-').length
      grandNoPunch += active.filter(r => !r.punchIn || r.punchIn === '-').length
    }

    lines.push(`📋 *Attendance · ${fmtDate(date)}*`)
    lines.push(`✅ ${grandPunched}   ❌ ${grandNoPunch}   📊 ${grandPunched}/${grandTotal}`)

    for (const g of visibleGroups) {
      const active = g.rows.filter(r => !r.isLeft)
      const punched = active.filter(r => r.punchIn && r.punchIn !== '-')
      const noPunch = active.filter(r => !r.punchIn || r.punchIn === '-')

      // Department header only if more than one department selected
      if (visibleGroups.length > 1) {
        lines.push('')
        lines.push(`━━━ *${g.department}* ━━━`)
      }

      if (punched.length > 0) {
        lines.push('')
        lines.push(`✅ *Punched (${punched.length})*`)
        for (const r of punched) {
          let punchStr: string
          if (r.punches && r.punches.length > 0) {
            // 9:18-13:01·14:58-19:34 — concise 24h, dot-separated sessions
            punchStr = pairPunches(r.punches)
              .map(([i, o]) => `${to24h(i)}-${o ? to24h(o) : '?'}`)
              .join('·')
          } else {
            punchStr = `${to24h(r.punchIn)}-${to24h(r.punchOut)}`
          }
          const hrs = shortHrs(r.workingHrs)
          const tail = hrs ? ` _(${hrs})_` : ''
          lines.push(`• *${r.name}* · ${punchStr}${tail}`)
        }
      }

      if (noPunch.length > 0) {
        lines.push('')
        lines.push(`❌ *No Punch (${noPunch.length})*`)
        for (const r of noPunch) {
          lines.push(`• ${r.name}`)
        }
      }
    }
    return lines.join('\n').trim()
  }

  function shareText() {
    const text = buildShareText()
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
  }
  function copyText() {
    const text = buildShareText()
    navigator.clipboard.writeText(text)
    alert('Copied to clipboard — paste into WhatsApp.')
  }

  // ── Multi-image share (one PNG per page so WhatsApp doesn't downscale a tall image) ──
  const ROWS_PER_IMAGE = 14
  const [imgBusy, setImgBusy] = useState(false)
  const [pendingPages, setPendingPages] = useState<SharePage[] | null>(null)

  function buildPages(): SharePage[] {
    const punched: AttendanceRow[] = []
    const noPunch: AttendanceRow[] = []
    for (const g of visibleGroups) {
      const active = g.rows.filter(r => !r.isLeft)
      for (const r of active) {
        if (r.punchIn && r.punchIn !== '-') punched.push(r)
        else noPunch.push(r)
      }
    }
    const totals = { total: punched.length + noPunch.length, punched: punched.length, noPunch: noPunch.length }
    const deptLabel = visibleGroups.map(g => g.department).join(' · ')

    const pages: SharePage[] = []
    if (punched.length === 0) {
      pages.push({ index: 1, total: 1, deptLabel, totals, rows: [], noPunch })
    } else {
      for (let i = 0; i < punched.length; i += ROWS_PER_IMAGE) {
        pages.push({ index: 0, total: 0, deptLabel, totals, rows: punched.slice(i, i + ROWS_PER_IMAGE) })
      }
      // Attach no-punch list to last page
      pages[pages.length - 1].noPunch = noPunch
      pages.forEach((p, idx) => { p.index = idx + 1; p.total = pages.length })
    }
    return pages
  }

  async function shareImage() {
    const computed = buildPages()
    if (computed.length === 0) return
    setImgBusy(true)
    setPendingPages(computed)
    // Wait two animation frames so the off-screen DOM mounts before we capture
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    try {
      const { default: html2canvas } = await import('html2canvas')
      const files: File[] = []
      for (let i = 0; i < computed.length; i++) {
        const node = document.getElementById(`attendance-img-page-${i}`)
        if (!node) continue
        const canvas = await html2canvas(node, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
        })
        const blob: Blob | null = await new Promise(res => canvas.toBlob(b => res(b), 'image/png'))
        if (blob) files.push(new File([blob], `attendance-${date}-${i + 1}.png`, { type: 'image/png' }))
      }
      if (files.length === 0) { alert('Image render failed'); return }

      // Try native share first. Fall back to single share if the platform
      // can't accept multiple files (some iOS combos), then to download.
      const canMulti = (navigator as any).canShare?.({ files })
      if (canMulti && navigator.share) {
        try {
          await navigator.share({ files, title: `Attendance ${date}`, text: `Attendance — ${fmtDate(date)}` })
          return
        } catch (e: any) { if (e?.name === 'AbortError') return }
      }
      if (files.length === 1 && (navigator as any).canShare?.({ files }) && navigator.share) {
        try { await navigator.share({ files, title: `Attendance ${date}` }); return }
        catch (e: any) { if (e?.name === 'AbortError') return }
      }
      // Final fallback: download every image
      for (const f of files) {
        const url = URL.createObjectURL(f)
        const a = document.createElement('a')
        a.href = url; a.download = f.name
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
      }
      alert(`Downloaded ${files.length} image(s) — upload to WhatsApp manually.`)
    } catch (e: any) {
      alert('Could not create images: ' + (e?.message || e))
    } finally {
      setImgBusy(false)
      setPendingPages(null)
    }
  }

  const disabled = !tokenInfo?.present || tokenInfo.expired

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-5">
        <div className="flex items-start gap-3">
          <BackButton />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Attendance</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">Petpooja Payroll · {tokenInfo?.orgName || daily?.orgName || '—'}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <a href="/attendance/employees"
            className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-semibold shadow-sm">
            👥 Employees (tag left)
          </a>
          <a href="/attendance/token"
            className="inline-flex items-center gap-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-xs font-semibold">
            🔑 Token
          </a>
        </div>
      </div>

      {!tokenInfo?.present && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">⚠️ Petpooja token not captured yet</p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
            Go to <a href="/attendance/token" className="underline">/attendance/token</a> to capture it.
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
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={shareImage} disabled={disabled || visibleGroups.length === 0 || imgBusy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-pink-600 text-white disabled:opacity-50">
            {imgBusy ? 'Rendering…' : '📸 Share Image(s)'}
          </button>
          <button onClick={copyText} disabled={disabled || visibleGroups.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50">
            📋 Copy Text
          </button>
          <button onClick={shareText} disabled={disabled || visibleGroups.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white disabled:opacity-50">
            📤 WhatsApp Text
          </button>
          <button onClick={() => window.print()} disabled={disabled || visibleGroups.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white disabled:opacity-50">
            🖨️ Print
          </button>
        </div>
      </div>

      {allDepts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">Departments:</span>
          {allDepts.map(d => {
            const sel = selectedDepts.has(d)
            return (
              <button key={d} onClick={() => toggleDept(d)}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${sel ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600'}`}>
                {d}
              </button>
            )
          })}
        </div>
      )}

      {disabled ? null : dailyLoading ? (
        <div className="p-10 text-center text-gray-400">Loading…</div>
      ) : (
        <div id="attendance-print-root" className="space-y-4">
          {visibleGroups.length === 0 && <div className="p-10 text-center text-gray-400">No departments selected.</div>}
          {visibleGroups.map(g => {
            const active = g.rows.filter(r => !r.isLeft)
            const leftCount = g.rows.length - active.length
            const punched = active.filter(r => r.punchIn && r.punchIn !== '-').length
            const noPunch = active.length - punched
            return (
            <div key={g.department} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="bg-emerald-700 text-white px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-bold">{g.department}</span>
                <span>|</span>
                <span>Total: {active.length}</span>
                <span>Punched: {punched}</span>
                <span>No Punch: {noPunch}</span>
                {leftCount > 0 && <span className="text-xs opacity-75">({leftCount} left)</span>}
                <span className="ml-auto text-xs opacity-90">({active.length ? Math.round((punched / active.length) * 100) : 0}%)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-300">
                    <tr>
                      <th className="px-2 py-1.5 text-left">ID</th>
                      <th className="px-2 py-1.5 text-left">Name</th>
                      <th className="px-2 py-1.5 text-left">Designation</th>
                      <th className="px-2 py-1.5 text-left">Punches</th>
                      <th className="px-2 py-1.5 text-left">Working Hrs</th>
                      <th className="px-2 py-1.5 text-left">Break</th>
                      <th className="px-2 py-1.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {active.map((r, i) => {
                      const hasPunches = (r.punches?.length || 0) > 0
                      return (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-2 py-1 text-gray-500">{r.id}</td>
                        <td className="px-2 py-1 font-semibold text-black dark:text-white">{r.name}</td>
                        <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{r.designation}</td>
                        <td className="px-2 py-1">
                          {hasPunches ? (
                            <div className="flex flex-wrap gap-1">
                              {r.punches!.map((p, pi) => (
                                <span key={pi}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${p.kind === 'IN'
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                                    : 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'}`}>
                                  {p.kind} {p.time}
                                </span>
                              ))}
                            </div>
                          ) : r.punchIn && r.punchIn !== '-' ? (
                            <span className="text-gray-500">{r.punchIn} → {r.punchOut !== '-' ? r.punchOut : '?'}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1 font-semibold text-black dark:text-white">{r.workingHrs}</td>
                        <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{r.break}</td>
                        <td className="px-2 py-1">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusColor(r.status)}`}>{r.status}</span>
                        </td>
                      </tr>
                    )})}
                    {active.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-center text-gray-400">No active rows</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )})}
        </div>
      )}

      {/* Off-screen render target for multi-image share. Positioned far off-screen
          so html2canvas can capture it without flashing on screen. */}
      {pendingPages && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0, zIndex: -1 }}>
          {pendingPages.map(p => <SharePageCard key={p.index} page={p} dateLabel={fmtDate(date)} />)}
        </div>
      )}
    </div>
  )
}
