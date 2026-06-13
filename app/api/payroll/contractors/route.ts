import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const includeInactive = searchParams.get('includeInactive') === '1'
  const search = searchParams.get('search')

  const where: Record<string, unknown> = {}
  if (!includeInactive) where.isActive = true
  if (search) where.name = { contains: search, mode: 'insensitive' }

  const contractors = await prisma.contractor.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { _count: { select: { staffContractors: true } } },
  })
  // Re-shape so client code keeps working with `_count.staff`.
  const shaped = contractors.map((c) => ({
    ...c,
    _count: { staff: c._count.staffContractors },
  }))
  return Response.json(shaped)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, tallyLedgerName, notes } = body
  if (!name?.trim()) return Response.json({ error: 'Name is required' }, { status: 400 })
  const trimmedName = name.trim()

  // Case-insensitive duplicate guard — "MOhmmed" and "Mohmmed" must not
  // be allowed to coexist. Returns the existing row so the caller can
  // link to it instead of erroring.
  const existing = await prisma.contractor.findFirst({
    where: { name: { equals: trimmedName, mode: 'insensitive' } },
    include: { _count: { select: { staffContractors: true } } },
  })
  if (existing) {
    return Response.json({
      error: `Contractor "${existing.name}" already exists (case-insensitive match). Use that one or rename it first.`,
      existing: { ...existing, _count: { staff: existing._count.staffContractors } },
    }, { status: 409 })
  }

  try {
    const c = await prisma.contractor.create({
      data: { name: trimmedName, tallyLedgerName: tallyLedgerName?.trim() || null, notes: notes?.trim() || null },
    })
    return Response.json(c)
  } catch (e) {
    const msg = (e as Error).message || 'Create failed'
    if (msg.includes('Unique')) return Response.json({ error: 'A contractor with that name already exists' }, { status: 409 })
    return Response.json({ error: msg }, { status: 400 })
  }
}
