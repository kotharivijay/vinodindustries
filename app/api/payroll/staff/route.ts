import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertAge18, isActiveFromStatus, normaliseAadhar, normaliseStatus } from '@/lib/payrollStaff'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')
  const paymentMode = searchParams.get('paymentMode') // SALARIED | CONTRACTOR_LINKED
  const contractorId = searchParams.get('contractorId') // 'none' for unassigned
  const department = searchParams.get('department')
  const status = searchParams.get('status') // ACTIVE | INACTIVE | DELETED — explicit filter
  const includeInactive = searchParams.get('includeInactive') === '1'

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  else if (!includeInactive) where.status = 'ACTIVE'
  if (paymentMode) where.paymentMode = paymentMode
  if (department) where.department = department
  if (contractorId === 'none') where.staffContractors = { none: {} }
  else if (contractorId) where.staffContractors = { some: { contractorId } }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { department: { contains: search, mode: 'insensitive' } },
    ]
  }

  const staff = await prisma.staff.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    include: {
      staffContractors: { include: { contractor: { select: { id: true, name: true } } } },
    },
  })
  // Flatten the join so the UI gets contractors[] directly.
  const shaped = staff.map((s) => ({
    ...s,
    contractors: s.staffContractors.map((sc) => ({ id: sc.contractor.id, name: sc.contractor.name })),
    // Drop the relation array from the response — cleaner client-side type.
    staffContractors: undefined,
  }))
  return Response.json(shaped)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { code, name, fatherName, aadhar, dob, department, monthlyBaseSalary, actualSalary, paymentMode, contractorIds, tallyLedgerName, notes, status, registerGroup } = body
  if (!code?.trim()) return Response.json({ error: 'Code is required' }, { status: 400 })
  if (!name?.trim()) return Response.json({ error: 'Name is required' }, { status: 400 })

  let normalisedAadhar: string | null
  try { normalisedAadhar = normaliseAadhar(aadhar) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }

  try { assertAge18(dob) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }

  const st = normaliseStatus(status)

  try {
    const s = await prisma.staff.create({
      data: {
        code: String(code).trim(),
        name: name.trim(),
        fatherName: fatherName?.trim() || null,
        aadhar: normalisedAadhar,
        dob: dob ? new Date(dob) : null,
        department: department?.trim() || null,
        monthlyBaseSalary: Number(monthlyBaseSalary) || 0,
        actualSalary: actualSalary != null ? Number(actualSalary) : null,
        paymentMode: paymentMode === 'CONTRACTOR_LINKED' ? 'CONTRACTOR_LINKED' : 'SALARIED',
        tallyLedgerName: tallyLedgerName?.trim() || null,
        registerGroup: registerGroup?.trim() || null,
        notes: notes?.trim() || null,
        status: st,
        isActive: isActiveFromStatus(st),
        staffContractors: Array.isArray(contractorIds) && contractorIds.length
          ? { create: contractorIds.map((cid: string) => ({ contractorId: cid })) }
          : undefined,
      },
      include: { staffContractors: { include: { contractor: { select: { id: true, name: true } } } } },
    })
    return Response.json({
      ...s,
      contractors: s.staffContractors.map((sc) => ({ id: sc.contractor.id, name: sc.contractor.name })),
      staffContractors: undefined,
    })
  } catch (e) {
    const msg = (e as Error).message || 'Create failed'
    if (msg.includes('Unique')) return Response.json({ error: `Code ${code} already exists` }, { status: 409 })
    return Response.json({ error: msg }, { status: 400 })
  }
}
