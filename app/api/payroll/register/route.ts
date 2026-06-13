import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { currentMonthKey, monthDaysFor } from '@/lib/payrollCalc'
import { getRegisterRows } from '@/lib/payrollRegisterData'

export const dynamic = 'force-dynamic'

// GET /api/payroll/register?month=YYYY-MM
// Returns the Salary Register rows for the month, in register order, each
// with its resolved STATUS marker (auto, or manual override).
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const month = (searchParams.get('month') || currentMonthKey()).trim()
  const data = await getRegisterRows(month)

  const totals = data.rows.reduce(
    (a, r) => ({
      salary: a.salary + r.salary,
      amount: a.amount + (r.amount || 0),
      reg: a.reg + (r.inRegister ? 1 : 0),
    }),
    { salary: 0, amount: 0, reg: 0 }
  )
  return Response.json({ ...data, count: data.rows.length, totals })
}

// PATCH /api/payroll/register
// Override (or clear) one row's STATUS cell for a month.
// Body: { staffId, month, registerStatus } — registerStatus:
//   string (incl. "") → set as manual override
//   null              → clear the override (revert to the auto marker)
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    staffId?: string; month?: string; registerStatus?: string | null
  }
  const staffId = body.staffId
  const monthKey = (body.month || currentMonthKey()).trim()
  if (!staffId) return Response.json({ error: 'staffId required' }, { status: 400 })

  const registerStatus = body.registerStatus === undefined ? null : body.registerStatus

  // The override lives on the (staff, month) wage entry. Upsert so it can be
  // set even before wages for the month have been calculated.
  await prisma.monthlyWageEntry.upsert({
    where: { staffId_monthKey: { staffId, monthKey } },
    update: { registerStatus },
    create: { staffId, monthKey, monthDays: monthDaysFor(monthKey), registerStatus },
  })

  return Response.json({ ok: true, staffId, monthKey, registerStatus })
}
