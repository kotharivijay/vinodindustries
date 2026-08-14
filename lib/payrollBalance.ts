// Server-side helper to rebuild a contractor's ContractorMonthlyBalance
// row from raw inputs (jobs + allocations + previous month's carry).
// Called any time a contractor process job is created/edited/deleted, or
// any time a staff's wage allocation changes.

import { prisma } from '@/lib/prisma'
import { recomputeBalance, previousMonthKey } from '@/lib/payrollCalc'

export async function recomputeContractorBalance(contractorId: string, monthKey: string): Promise<{
  openingCarry: number; jobsTotal: number; distributed: number; closingCarry: number
}> {
  // Opening carry = previous month's closingCarry (0 if no prior row) + this
  // month's manual add/less (openingAdjust), which lives in its own column
  // precisely so it survives this recompute.
  const prevKey = previousMonthKey(monthKey)
  const [prev, current] = await Promise.all([
    prisma.contractorMonthlyBalance.findUnique({
      where: { contractorId_monthKey: { contractorId, monthKey: prevKey } },
    }),
    prisma.contractorMonthlyBalance.findUnique({
      where: { contractorId_monthKey: { contractorId, monthKey } },
      select: { openingAdjust: true },
    }),
  ])
  const openingAdjust = (current as any)?.openingAdjust || 0
  const openingCarry = (prev?.closingCarry || 0) + openingAdjust

  const [jobs, allocations] = await Promise.all([
    prisma.contractorProcessJob.findMany({
      where: { contractorId, monthKey },
      select: { total: true },
    }),
    prisma.wageContractorAllocation.findMany({
      where: { contractorId, wageEntry: { monthKey } },
      select: { share: true },
    }),
  ])

  const { jobsTotal, distributed, closingCarry } = recomputeBalance({
    openingCarry,
    jobs,
    allocations,
  })

  const result = await prisma.contractorMonthlyBalance.upsert({
    where: { contractorId_monthKey: { contractorId, monthKey } },
    update: { openingCarry, jobsTotal, distributed, closingCarry },
    create: { contractorId, monthKey, openingCarry, openingAdjust, jobsTotal, distributed, closingCarry },
  })
  return result
}
