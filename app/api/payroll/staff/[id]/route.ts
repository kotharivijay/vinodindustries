import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertAge18, isActiveFromStatus, normaliseAadhar, normaliseStatus } from '@/lib/payrollStaff'
import { buildRevision, inactivatedMonthForTransition } from '@/lib/payrollRevision'
import { currentMonthKey } from '@/lib/payrollCalc'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  // Snapshot the current salaries + status so we can record salary
  // revisions and stamp inactivatedMonth on a status transition.
  const existing = await prisma.staff.findUnique({
    where: { id },
    select: { monthlyBaseSalary: true, actualSalary: true, status: true },
  })
  if (!existing) return Response.json({ error: 'Staff not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.code === 'string') data.code = body.code.trim()
  if (typeof body.name === 'string') data.name = body.name.trim()
  if ('fatherName' in body) data.fatherName = body.fatherName?.trim() || null
  if ('aadhar' in body) {
    try { data.aadhar = normaliseAadhar(body.aadhar) }
    catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }
  }
  if ('dob' in body) {
    try { assertAge18(body.dob) }
    catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }
    data.dob = body.dob ? new Date(body.dob) : null
  }
  if ('department' in body) data.department = body.department?.trim() || null
  if ('monthlyBaseSalary' in body) data.monthlyBaseSalary = Number(body.monthlyBaseSalary) || 0
  if ('actualSalary' in body) data.actualSalary = body.actualSalary != null ? Number(body.actualSalary) : null
  if (typeof body.paymentMode === 'string') {
    data.paymentMode = body.paymentMode === 'CONTRACTOR_LINKED' ? 'CONTRACTOR_LINKED' : 'SALARIED'
  }
  if ('tallyLedgerName' in body) data.tallyLedgerName = body.tallyLedgerName?.trim() || null
  if ('notes' in body) data.notes = body.notes?.trim() || null

  // status drives isActive (and vice versa for back-compat callers). On a
  // transition to/from ACTIVE we also stamp/clear inactivatedMonth so the
  // register can show a "deleted" marker in the prior month.
  const revMonth: string = typeof body.salaryRevisionMonth === 'string' && body.salaryRevisionMonth
    ? body.salaryRevisionMonth
    : currentMonthKey()
  if (typeof body.status === 'string') {
    const st = normaliseStatus(body.status)
    data.status = st
    data.isActive = isActiveFromStatus(st)
    const inMonth = inactivatedMonthForTransition(existing.status, st, revMonth)
    if (inMonth !== undefined) data.inactivatedMonth = inMonth
  } else if (typeof body.isActive === 'boolean') {
    const st = body.isActive ? 'ACTIVE' : 'INACTIVE'
    data.isActive = body.isActive
    data.status = st
    const inMonth = inactivatedMonthForTransition(existing.status, st, revMonth)
    if (inMonth !== undefined) data.inactivatedMonth = inMonth
  }

  // Record a salary revision per field that actually moved.
  const changedBy = session.user?.email ?? null
  const revisions = [
    'monthlyBaseSalary' in body
      ? buildRevision({ staffId: id, field: 'REGISTER', oldValue: existing.monthlyBaseSalary, newValue: data.monthlyBaseSalary as number, effectiveMonth: revMonth, changedBy })
      : null,
    'actualSalary' in body
      ? buildRevision({ staffId: id, field: 'ACTUAL', oldValue: existing.actualSalary, newValue: data.actualSalary as number | null, effectiveMonth: revMonth, changedBy })
      : null,
  ].filter(Boolean) as import('@prisma/client').Prisma.StaffSalaryRevisionCreateManyInput[]

  try {
    if (Array.isArray(body.contractorIds)) {
      await prisma.$transaction([
        prisma.staffContractor.deleteMany({ where: { staffId: id } }),
        ...(body.contractorIds.length
          ? [prisma.staffContractor.createMany({
              data: body.contractorIds.map((cid: string) => ({ staffId: id, contractorId: cid })),
              skipDuplicates: true,
            })]
          : []),
        prisma.staff.update({ where: { id }, data }),
        ...(revisions.length ? [prisma.staffSalaryRevision.createMany({ data: revisions })] : []),
      ])
    } else if (Object.keys(data).length > 0 || revisions.length) {
      await prisma.$transaction([
        ...(Object.keys(data).length ? [prisma.staff.update({ where: { id }, data })] : []),
        ...(revisions.length ? [prisma.staffSalaryRevision.createMany({ data: revisions })] : []),
      ])
    }
    const updated = await prisma.staff.findUnique({
      where: { id },
      include: { staffContractors: { include: { contractor: { select: { id: true, name: true } } } } },
    })
    return Response.json({
      ...updated,
      contractors: updated?.staffContractors.map((sc) => ({ id: sc.contractor.id, name: sc.contractor.name })) || [],
      staffContractors: undefined,
    })
  } catch (e) {
    const msg = (e as Error).message || 'Update failed'
    if (msg.includes('Unique')) return Response.json({ error: 'Code already exists' }, { status: 409 })
    return Response.json({ error: msg }, { status: 400 })
  }
}

// DELETE — soft-delete by setting status=DELETED (keeps history for past
// MonthlyWageEntry rows that reference this staff via FK).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.staff.findUnique({ where: { id }, select: { status: true } })
  const data: Record<string, unknown> = { status: 'DELETED', isActive: false }
  const inMonth = inactivatedMonthForTransition(existing?.status, 'DELETED')
  if (inMonth !== undefined) data.inactivatedMonth = inMonth
  await prisma.staff.update({ where: { id }, data })
  return Response.json({ ok: true })
}
