export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchEmployeePunches, getPetpoojaAuth, payrollHeaders, PETPOOJA_PAYROLL_BASE } from '@/lib/petpooja'

export const maxDuration = 60

/**
 * GET /api/attendance/daily?date=YYYY-MM-DD
 *
 * Fetches the attendance_master report for the single branch bound to
 * the saved token. Groups rows by `department` so each department
 * appears as its own section (matching the Petpooja UI layout).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const from = req.nextUrl.searchParams.get('from') || date
  const to = req.nextUrl.searchParams.get('to') || date

  let auth
  try { auth = await getPetpoojaAuth() }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }) }

  const res = await fetch(`${PETPOOJA_PAYROLL_BASE}/reports/attendance_master`, {
    method: 'POST',
    headers: payrollHeaders(auth),
    body: JSON.stringify({
      filter_start_date: from,
      filter_end_date: to,
      filter_branch: null, // null = all branches; org filter happens via JWT scope
    }),
  })
  const text = await res.text()
  if (!res.ok) return NextResponse.json({ error: `Petpooja ${res.status}`, body: text.slice(0, 500) }, { status: res.status })

  let payload: any
  try { payload = JSON.parse(text) }
  catch { return NextResponse.json({ error: 'Non-JSON response', body: text.slice(0, 500) }, { status: 502 })}

  const rows: any[] = Array.isArray(payload?.data) ? payload.data : []

  // Mark employees who have left the job (stored in AttendanceEmployee)
  const db = prisma as any
  const left = await db.attendanceEmployee.findMany({ where: { status: 'left' }, select: { petpoojaEmpId: true } })
  const leftSet = new Set(left.map((e: any) => Number(e.petpoojaEmpId)))

  // Per-employee punch detail. Petpooja only exposes this one-by-one — fan
  // out in chunks. Skip employees with no first_punch (absent/leave/holiday)
  // since they have nothing to fetch. Failures are non-fatal: row keeps
  // first/last only.
  const targetEmpIds: number[] = []
  for (const r of rows) {
    const id = Number(r.employee_id)
    if (!Number.isFinite(id) || !id) continue
    const fp = (r.first_punch || '').trim()
    if (!fp || fp === '-') continue
    if (leftSet.has(id)) continue
    targetEmpIds.push(id)
  }

  const punchesByEmp = new Map<number, { time: string; kind: 'IN' | 'OUT' }[]>()
  const concurrency = 8
  for (let i = 0; i < targetEmpIds.length; i += concurrency) {
    const slice = targetEmpIds.slice(i, i + concurrency)
    await Promise.all(slice.map(async empId => {
      try {
        const all = await fetchEmployeePunches(auth, empId)
        const onDate = all.filter(p => (p.punch_log_date || '').slice(0, 10) === date)
        onDate.sort((a, b) => String(a.punch_log_time || '').localeCompare(String(b.punch_log_time || '')))
        punchesByEmp.set(empId, onDate.map((p, idx) => ({
          time: p.log_time || (p.punch_log_time || '').slice(11, 16) || '—',
          kind: idx % 2 === 0 ? 'IN' : 'OUT',
        })))
      } catch { /* leave row with first/last only */ }
    }))
  }

  // Group by department (matches the "Vinod Industries" / "Vi Folding" sections)
  const byDept = new Map<string, any[]>()
  for (const r of rows) {
    const key = (r.department || r.designation || 'Unassigned').toString().trim() || 'Unassigned'
    if (!byDept.has(key)) byDept.set(key, [])
    byDept.get(key)!.push(r)
  }

  const groups = Array.from(byDept.entries()).map(([dept, list]) => {
    let fd = 0, hd = 0, absent = 0
    for (const r of list) {
      const s = (r.status || '').toLowerCase()
      if (s === 'fd' || s.includes('present') || s === 'p') fd++
      else if (s === 'hd' || s.includes('half')) hd++
      else if (s.includes('absent') || s === 'a') absent++
    }
    return {
      department: dept,
      total: list.length,
      present: fd,
      halfDay: hd,
      absent,
      attendancePct: list.length ? Math.round((fd / list.length) * 100) : 0,
      rows: list.map(r => {
        const empId = Number(r.employee_id) || null
        return {
          id: r.code ?? r.employee_id ?? r.device_employee_id ?? '—',
          petpoojaEmpId: empId,
          name: r.name || '—',
          designation: r.designation || '—',
          punchIn: r.first_punch || '-',
          punchOut: r.last_punch || '-',
          workingHrs: r.working_hrs || '-',
          break: r.break_hrs || '-',
          status: r.status || '—',
          isLeft: leftSet.has(Number(r.employee_id)),
          leaveName: r.leave_name,
          holidayName: r.holiday_name,
          punches: empId ? (punchesByEmp.get(empId) || []) : [],
        }
      }),
    }
  })

  groups.sort((a, b) => a.department.localeCompare(b.department))

  return NextResponse.json({
    date,
    orgName: auth.orgName,
    orgId: auth.orgId,
    groups,
    totalRows: rows.length,
  })
}
