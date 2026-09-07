export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeDay, pairPunches } from '@/lib/attendance-calc'

/**
 * GET /api/attendance/daily?date=YYYY-MM-DD
 *
 * Reads the uploaded Petpooja punch sheet (AttendancePunchDay) for one date
 * and groups rows by department. The envelope is unchanged from the old
 * live-API version so the page's table / WhatsApp / image code is untouched;
 * `hasData` is the one addition (false → "upload a sheet for this date").
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const db = prisma as any

  const [days, emps] = await Promise.all([
    db.attendancePunchDay.findMany({ where: { date }, orderBy: [{ department: 'asc' }, { name: 'asc' }] }),
    db.attendanceEmployee.findMany({ select: { code: true, petpoojaEmpId: true, status: true, department: true, designation: true } }),
  ])

  // Sheet "Employee ID" vs AttendanceEmployee.code may differ by leading
  // zeros / whitespace; codes are not unique there either — prefer 'active'.
  const normCode = (c: unknown) => String(c ?? '').trim().replace(/^0+(?=\d)/, '')
  const empByCode = new Map<string, any>()
  for (const e of emps) {
    const k = normCode(e.code)
    if (!k) continue
    const cur = empByCode.get(k)
    if (!cur || (cur.status !== 'active' && e.status === 'active')) empByCode.set(k, e)
  }

  const byDept = new Map<string, any[]>()
  for (const d of days) {
    const emp = empByCode.get(normCode(d.code))
    const times: string[] = Array.isArray(d.punches) ? d.punches : []
    const calc = computeDay(times)
    const { punches } = pairPunches(times)
    const row = {
      id: d.code,
      petpoojaEmpId: emp?.petpoojaEmpId ?? null,
      name: d.name || '—',
      designation: d.designation || emp?.designation || '—',
      punchIn: times[0] ?? '-',
      punchOut: times.length > 1 ? times[times.length - 1] : '-',
      workingHrs: calc.workingHrs,
      break: calc.breakHrs,
      status: calc.status,
      isLeft: emp?.status === 'left',
      leaveName: null,
      holidayName: null,
      punches,
      punchProblem: calc.problem,
    }
    const key = (d.department || emp?.department || d.designation || 'Unassigned').toString().trim() || 'Unassigned'
    if (!byDept.has(key)) byDept.set(key, [])
    byDept.get(key)!.push(row)
  }

  const groups = Array.from(byDept.entries()).map(([dept, rows]) => {
    const fd = rows.filter(r => r.status === 'FD').length
    const hd = rows.filter(r => r.status === 'HD').length
    const absent = rows.filter(r => r.status === 'ABSENT').length
    return {
      department: dept,
      total: rows.length,
      present: fd, halfDay: hd, absent,
      attendancePct: rows.length ? Math.round((fd / rows.length) * 100) : 0,
      rows,
    }
  })
  groups.sort((a, b) => a.department.localeCompare(b.department))

  return NextResponse.json({
    date,
    orgName: 'Uploaded punch sheet',
    orgId: 0,
    groups,
    totalRows: days.length,
    hasData: days.length > 0,
  })
}
