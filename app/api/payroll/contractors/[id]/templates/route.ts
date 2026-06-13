import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/payroll/contractors/[id]/templates
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const templates = await prisma.contractorJobTemplate.findMany({
    where: { contractorId: id, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return Response.json(templates)
}

// POST /api/payroll/contractors/[id]/templates
// Body: { processName, quality?, rate, sortOrder? }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await request.json()
  const { processName, quality, rate, sortOrder } = body
  if (!processName?.trim() || !rate || Number(rate) <= 0) {
    return Response.json({ error: 'processName and positive rate are required' }, { status: 400 })
  }
  const t = await prisma.contractorJobTemplate.create({
    data: {
      contractorId: id,
      processName: String(processName).trim(),
      quality: quality?.trim() || null,
      rate: Number(rate),
      sortOrder: Number(sortOrder) || 0,
    },
  })
  return Response.json(t)
}
