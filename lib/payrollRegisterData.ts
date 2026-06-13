// Server-side builder for the Salary Register rows. Joins Staff + the
// month's MonthlyWageEntry + that month's salary revisions, applies the
// inclusion + STATUS-marker rules, and returns rows in register order.
// Shared by the register GET route and the CSV export route.

import { prisma } from '@/lib/prisma'
import { currentMonthKey, dailyRateFor, monthDaysFor, previousMonthKey } from '@/lib/payrollCalc'
import {
  autoStatusMarker,
  isNewStaffCode,
  resolveStatus,
  type RegisterRow,
} from '@/lib/payrollRegister'

export async function getRegisterRows(month: string): Promise<{
  monthKey: string
  monthDays: number
  rows: RegisterRow[]
}> {
  const monthKey = (month || currentMonthKey()).trim()
  const monthDays = monthDaysFor(monthKey)

  const [staff, entries, revisions] = await Promise.all([
    // All staff (incl. inactive/deleted) — inclusion is decided per-row so a
    // staff who left next month still shows in this month with "deleted".
    prisma.staff.findMany({
      select: {
        id: true, code: true, name: true, department: true,
        monthlyBaseSalary: true, inRegister: true, registerSn: true,
        inactivatedMonth: true, status: true, createdAt: true,
      },
    }),
    prisma.monthlyWageEntry.findMany({
      where: { monthKey },
      select: { staffId: true, daysWorked: true, dailyRate: true, calculatedWage: true, registerStatus: true },
    }),
    prisma.staffSalaryRevision.findMany({
      where: { effectiveMonth: monthKey },
      select: { staffId: true },
    }),
  ])

  const entryByStaff = new Map(entries.map((e) => [e.staffId, e]))
  const incThisMonth = new Set(revisions.map((r) => r.staffId))

  // A genuinely-new 999x staff "starts" in the month BEFORE they were added,
  // because the register is prepared one month in arrears (added in June while
  // building May → starts in May). Permanent-code staff have no start gate.
  const newStartMonth = (s: { code: string; createdAt: Date }): string | null =>
    isNewStaffCode(s.code) ? previousMonthKey(currentMonthKey(s.createdAt)) : null

  const included = staff.filter((s) => {
    // Legacy: staff marked inactive/deleted before inactivatedMonth tracking
    // existed have no month stamp — treat them as long gone (never appear).
    if (s.status !== 'ACTIVE' && !s.inactivatedMonth) return false
    // Gone from inactivatedMonth onward (still shows the month BEFORE, where
    // the "deleted" marker lands).
    if (s.inactivatedMonth && s.inactivatedMonth <= monthKey) return false
    // New 999x staff don't appear before their start month.
    const start = newStartMonth(s)
    if (start && start > monthKey) return false
    return true
  })

  // Register order: explicit registerSn first (ascending), then unplaced
  // staff by name. Stable + reproduces the pasted sheet's order.
  included.sort((a, b) => {
    const sa = a.registerSn ?? Number.MAX_SAFE_INTEGER
    const sb = b.registerSn ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return a.name.localeCompare(b.name)
  })

  const rows: RegisterRow[] = included.map((s, i) => {
    const e = entryByStaff.get(s.id)
    // Day / Perday / Amount come from the live wage system (the posted
    // MonthlyWageEntry), NOT the old ÷30 sheet convention. Perday falls back
    // to the computed daily rate when no entry exists yet. No wage entry or
    // zero days ⇒ Day 0 and Amount 0 (never blank).
    const days = e?.daysWorked ?? 0
    const perDay = Math.round(e?.dailyRate ?? dailyRateFor(s.monthlyBaseSalary, monthDays))
    const amount = e && days > 0 ? Math.round(e.calculatedWage) : 0
    const autoStatus = autoStatusMarker({
      monthKey,
      code: s.code,
      inactivatedMonth: s.inactivatedMonth,
      hasSalaryInc: incThisMonth.has(s.id),
      isFirstRegisterMonth: newStartMonth(s) === monthKey,
    })
    const override = e?.registerStatus ?? null
    return {
      staffId: s.id,
      sn: i + 1,
      code: s.code,
      name: s.name,
      department: s.department,
      salary: s.monthlyBaseSalary,
      perDay,
      days,
      amount,
      status: resolveStatus(override, autoStatus),
      autoStatus,
      statusOverridden: override != null,
      inRegister: s.inRegister,
    }
  })

  return { monthKey, monthDays, rows }
}
