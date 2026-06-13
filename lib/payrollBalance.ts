// Server-side helper to rebuild a contractor's ContractorMonthlyBalance
// row from raw inputs (jobs + allocations + previous month's carry).
// Called any time a contractor process job is created/edited/deleted, or
// any time a staff's wage allocation changes.

import { prisma } from '@/lib/prisma'
import { recomputeBalance, previousMonthKey } from '@/lib/payrollCalc'

export async function recomputeContractorBalance(contractorId: string, monthKey: string): Promise<{
  openingCarry: number; jobsTotal: number; distributed: number; closingCarry: number
}> {
  // Opening carry = previous month's closingCarry (0 if no prior row).
  const prevKey = previousMonthKey(monthKey)
  const prev = await prisma.contractorMonthlyBalance.findUnique({
    where: { contractorId_monthKey: { contractorId, monthKey: prevKey } },
  })
  const openingCarry = prev?.closingCarry || 0

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
    create: { contractorId, monthKey, openingCarry, jobsTotal, distributed, closingCarry },
  })
  return result
}
