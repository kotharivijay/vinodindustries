import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recomputeContractorBalance } from '@/lib/payrollBalance'

// POST /api/payroll/contractor-balance/adjust
// { contractorId, monthKey, openingAdjust }
// Sets the manual add/less on a contractor's opening carry for a month
// (absolute value, negative = less), then recomputes the balance so
// openingCarry = prev month's closing + openingAdjust flows through
// pool / distributed / closing.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { contractorId, monthKey } = body
  const openingAdjust = Number(body.openingAdjust)
  if (!contractorId || !monthKey || !Number.isFinite(openingAdjust)) {
    return Response.json({ error: 'contractorId, monthKey and openingAdjust are required' }, { status: 400 })
  }

  await (prisma as any).contractorMonthlyBalance.upsert({
    where: { contractorId_monthKey: { contractorId, monthKey } },
    update: { openingAdjust },
    create: { contractorId, monthKey, openingAdjust },
  })
  const balance = await recomputeContractorBalance(contractorId, monthKey)
  return Response.json({ ok: true, balance })
}
