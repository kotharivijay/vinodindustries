// Per-staff running carry helpers (analogue of ContractorMonthlyBalance,
// but stored inline on each MonthlyWageEntry).
//
//   target        = the "what should be paid" amount this month
//                 = actualSalary > 0  →  (actualSalary / 30) × actualDaysWorked
//                                       (falls back to monthlyBaseSalary when no actDays set)
//                 = otherwise           →  monthlyBaseSalary
//   closingCarry  = openingCarry + target − calculatedWage
//   next month's openingCarry = this month's closingCarry

import { prisma } from '@/lib/prisma'
import { previousMonthKey } from '@/lib/payrollCalc'

// Pull the previous month's closingCarry for a given (staff, month).
// Returns 0 if no prior entry exists (first-time staff or first ever month).
export async function fetchPreviousCarry(staffId: string, monthKey: string): Promise<number> {
  const prevKey = previousMonthKey(monthKey)
  const prev = await prisma.monthlyWageEntry.findUnique({
    where: { staffId_monthKey: { staffId, monthKey: prevKey } },
    select: { closingCarry: true },
  })
  return prev?.closingCarry || 0
}

// Compute the target salary for a row given the staff's salary settings.
export function targetSalaryFor(opts: {
  monthlyBaseSalary: number
  actualSalary: number | null | undefined
  actualDaysWorked: number | null | undefined
  monthDays: number
}): number {
  if (opts.actualSalary != null && opts.actualSalary > 0) {
    const actDays = opts.actualDaysWorked ?? opts.monthDays
    return (opts.actualSalary / 30) * actDays
  }
  return opts.monthlyBaseSalary
}

// closingCarry = openingCarry + target − calculatedWage
export function computeClosingCarry(opts: {
  openingCarry: number
  target: number
  calculatedWage: number
}): number {
  return (opts.openingCarry || 0) + (opts.target || 0) - (opts.calculatedWage || 0)
}
