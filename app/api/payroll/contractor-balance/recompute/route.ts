import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recomputeContractorBalance } from '@/lib/payrollBalance'

// POST /api/payroll/contractor-balance/recompute
// Body: { contractorId?: string, monthKey: string }
// If contractorId omitted, recomputes for all contractors that have
// any jobs or allocations in that month.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { contractorId?: string; monthKey?: string }
  const monthKey = (body.monthKey || '').trim()
  if (!monthKey) return Response.json({ error: 'monthKey is required' }, { status: 400 })

  let contractorIds: string[]
  if (body.contractorId) {
    contractorIds = [body.contractorId]
  } else {
    const [jobIds, allocIds] = await Promise.all([
      prisma.contractorProcessJob.findMany({ where: { monthKey }, select: { contractorId: true }, distinct: ['contractorId'] }),
      prisma.wageContractorAllocation.findMany({ where: { wageEntry: { monthKey } }, select: { contractorId: true }, distinct: ['contractorId'] }),
    ])
    contractorIds = [...new Set([...jobIds.map((j) => j.contractorId), ...allocIds.map((a) => a.contractorId)])]
  }

  const results = []
  for (const cid of contractorIds) {
    const r = await recomputeContractorBalance(cid, monthKey)
    results.push({ contractorId: cid, ...r })
  }
  return Response.json({ recomputed: results.length, balances: results })
}
