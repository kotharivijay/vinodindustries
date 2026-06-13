import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recomputeContractorBalance } from '@/lib/payrollBalance'

// GET /api/payroll/contractor-jobs?contractorId=&month=
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const contractorId = searchParams.get('contractorId')
  const monthKey = searchParams.get('month')
  if (!contractorId || !monthKey) return Response.json({ error: 'contractorId and month are required' }, { status: 400 })

  const jobs = await prisma.contractorProcessJob.findMany({
    where: { contractorId, monthKey },
    orderBy: { createdAt: 'asc' },
  })
  return Response.json(jobs)
}

// POST /api/payroll/contractor-jobs
// Body: { contractorId, monthKey, processName, quality?, rate, quantity, notes? }
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { contractorId, monthKey, processName, quality, rate, quantity, notes } = body
  if (!contractorId || !monthKey || !processName) {
    return Response.json({ error: 'contractorId, monthKey, processName are required' }, { status: 400 })
  }
  const r = Number(rate) || 0
  const q = Number(quantity) || 0
  const job = await prisma.contractorProcessJob.create({
    data: {
      contractorId, monthKey,
      processName: String(processName).trim(),
      quality: quality?.trim() || null,
      rate: r,
      quantity: q,
      total: r * q,
      notes: notes?.trim() || null,
    },
  })
  await recomputeContractorBalance(contractorId, monthKey)
  return Response.json(job)
}
