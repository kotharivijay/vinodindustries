export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchEmployeePunches, getPetpoojaAuth } from '@/lib/petpooja'

export const maxDuration = 60

/**
 * GET /api/attendance/punches?empId=27&date=YYYY-MM-DD
 *
 * Returns every punch for an employee on the given date. Petpooja's
 * employee_punch_data endpoint returns the whole pay-period — we filter
 * client-side by `punch_log_date`.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const empId = Number(req.nextUrl.searchParams.get('empId'))
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  if (!empId) return NextResponse.json({ error: 'empId required' }, { status: 400 })

  let auth
  try { auth = await getPetpoojaAuth() }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }) }

  let all: any[] = []
  try { all = await fetchEmployeePunches(auth, empId) }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 502 }) }

  const onDate = all.filter(p => (p.punch_log_date || '').slice(0, 10) === date)

  // Sort by punch_log_time so morning punches come first
  onDate.sort((a, b) => String(a.punch_log_time || '').localeCompare(String(b.punch_log_time || '')))

  // Mark in/out alternately starting with IN. Petpooja's UI does this — the
  // raw row has no kind flag, the order is the truth.
  const punches = onDate.map((p, i) => ({
    time: p.log_time || (p.punch_log_time || '').slice(11, 16) || '—',
    fullTime: p.punch_log_time || null,
    kind: i % 2 === 0 ? 'IN' : 'OUT',
    deviceEmpId: p.device_emp_id || null,
    raw: p,
  }))

  return NextResponse.json({ empId, date, count: punches.length, punches })
}
