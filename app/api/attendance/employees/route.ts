export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPetpoojaAuth, payrollHeaders, PETPOOJA_PAYROLL_BASE } from '@/lib/petpooja'

/**
 * GET /api/attendance/employees
 *  - Fetches today's attendance_master so we discover every employee
 *  - Upserts any missing ones into AttendanceEmployee (status=active)
 *  - Returns all rows (active + left) merged with Petpooja details
 *
 * POST /api/attendance/employees  { petpoojaEmpId, status, notes?, leftDate? }
 *  - Toggles an employee's status between 'active' and 'left'
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  let auth
  try { auth = await getPetpoojaAuth() }
  catch (e: any) {
    // If no token, still return whatever we have stored
    const stored = await db.attendanceEmployee.findMany({ orderBy: { petpoojaEmpId: 'asc' } })
    return NextResponse.json({ employees: stored, tokenError: e.message })
  }

  // Pull today's attendance_master — that roster contains everyone the Petpooja
  // org knows about. Upsert into our local table.
  const today = new Date().toISOString().slice(0, 10)
  let liveEmployees: any[] = []
  try {
    const res = await fetch(`${PETPOOJA_PAYROLL_BASE}/reports/attendance_master`, {
      method: 'POST',
      headers: payrollHeaders(auth),
      body: JSON.stringify({ filter_start_date: today, filter_end_date: today, filter_branch: null }),
    })
    const d = await res.json()
    liveEmployees = Array.isArray(d?.data) ? d.data : []
  } catch {}

  for (const e of liveEmployees) {
    const empId = Number(e.employee_id)
    if (!Number.isFinite(empId) || !empId) continue
    await db.attendanceEmployee.upsert({
      where: { petpoojaEmpId: empId },
      update: {
        code: String(e.code ?? ''),
        name: e.name || '',
        department: e.department || null,
        designation: e.designation || null,
      },
      create: {
        petpoojaEmpId: empId,
        code: String(e.code ?? ''),
        name: e.name || '',
        department: e.department || null,
        designation: e.designation || null,
      },
    })
  }

  const stored = await db.attendanceEmployee.findMany({ orderBy: [{ status: 'asc' }, { department: 'asc' }, { petpoojaEmpId: 'asc' }] })
  return NextResponse.json({ employees: stored })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { petpoojaEmpId, status, notes, leftDate } = await req.json()
  if (!petpoojaEmpId) return NextResponse.json({ error: 'petpoojaEmpId required' }, { status: 400 })
  if (!['active', 'left'].includes(status)) return NextResponse.json({ error: 'status must be active|left' }, { status: 400 })

  const db = prisma as any
  const data: any = { status }
  if (notes !== undefined) data.notes = notes || null
  if (status === 'left' && !leftDate) data.leftDate = new Date()
  else if (leftDate) data.leftDate = new Date(leftDate)
  else if (status === 'active') data.leftDate = null

  const updated = await db.attendanceEmployee.update({
    where: { petpoojaEmpId: Number(petpoojaEmpId) },
    data,
  })
  return NextResponse.json({ ok: true, employee: updated })
}
