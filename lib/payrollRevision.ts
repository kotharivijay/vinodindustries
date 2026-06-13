// Salary-revision capture helpers shared by the staff POST/PATCH/import
// routes. A revision row is written whenever a staff's Register Salary
// (monthlyBaseSalary) or Actual Salary (actualSalary) actually changes, so
// the register can show a "salary inc" marker for the effective month and
// the UI can render a Salary History panel.

import type { Prisma } from '@prisma/client'
import { currentMonthKey } from './payrollCalc'

export type SalaryField = 'REGISTER' | 'ACTUAL'

export type RevisionInput = {
  staffId: string
  field: SalaryField
  oldValue: number | null | undefined
  newValue: number | null | undefined
  effectiveMonth?: string
  changedBy?: string | null
  note?: string | null
}

// Build a createMany input for a salary revision, or null when nothing
// meaningfully changed (same value, or null→null). Treats null/undefined as 0
// so a first-time set is recorded with deltaPercent 0 (no prior base).
export function buildRevision(input: RevisionInput): Prisma.StaffSalaryRevisionCreateManyInput | null {
  const oldV = input.oldValue ?? 0
  const newV = input.newValue ?? 0
  if (oldV === newV) return null
  const deltaAmount = newV - oldV
  const deltaPercent = oldV > 0 ? (deltaAmount / oldV) * 100 : 0
  return {
    staffId: input.staffId,
    field: input.field,
    oldValue: oldV,
    newValue: newV,
    deltaAmount,
    deltaPercent,
    effectiveMonth: input.effectiveMonth || currentMonthKey(),
    changedBy: input.changedBy ?? null,
    note: input.note ?? null,
  }
}

// Given a status transition, return the inactivatedMonth value to persist:
//   → moving to INACTIVE/DELETED (from active): set to the given month.
//   → moving back to ACTIVE: clear (null).
//   → no relevant transition: undefined (leave the column untouched).
export function inactivatedMonthForTransition(
  prevStatus: string | null | undefined,
  nextStatus: string,
  month: string = currentMonthKey(),
): string | null | undefined {
  const wasActive = (prevStatus ?? 'ACTIVE') === 'ACTIVE'
  const nowActive = nextStatus === 'ACTIVE'
  if (wasActive && !nowActive) return month // first month they drop off
  if (!wasActive && nowActive) return null // reactivated — back on the register
  return undefined
}
