export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPetpoojaAuth, fetchAllEmployees } from '@/lib/petpooja'

/**
 * GET /api/attendance/employees
 *  - Pulls the FULL employee master from attendanceinfo.petpooja.com
 *    (/get_employees with method=employee_list_tmp). This returns every
 *    employee Petpooja knows — active, left, inactive, across all
 *    branches — unlike `attendance_master` which is roster-filtered to
 *    one branch.
 *  - Upserts each row into AttendanceEmployee, then returns all rows.
 *
 * POST /api/attendance/employees  { petpoojaEmpId, status, notes?, leftDate? }
 *  - Toggles an employee's status between 'active' and 'left'.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  let auth
  try { auth = await getPetpoojaAuth() }
  catch (e: any) {
    const stored = await db.attendanceEmployee.findMany({ orderBy: { petpoojaEmpId: 'asc' } })
    return NextResponse.json({ employees: stored, tokenError: e.message })
  }

  let liveEmployees: Awaited<ReturnType<typeof fetchAllEmployees>> = []
  let fetchError: string | null = null
  try {
    liveEmployees = await fetchAllEmployees(auth)
  } catch (e: any) {
    fetchError = e?.message || 'fetchAllEmployees failed'
  }

  for (const e of liveEmployees) {
    await db.attendanceEmployee.upsert({
      where: { petpoojaEmpId: e.petpoojaEmpId },
      update: {
        code: e.code ?? '',
        name: e.name,
        department: e.department,
        designation: e.designation,
      },
      create: {
        petpoojaEmpId: e.petpoojaEmpId,
        code: e.code ?? '',
        name: e.name,
        department: e.department,
        designation: e.designation,
      },
    })
  }

  const stored = await db.attendanceEmployee.findMany({
    orderBy: [{ status: 'asc' }, { department: 'asc' }, { petpoojaEmpId: 'asc' }],
  })
  return NextResponse.json({ employees: stored, fetchError, syncedFromPetpooja: liveEmployees.length })
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
