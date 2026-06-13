// Salary Register helpers — the STATUS-column logic and the column math for
// the printed register the firm files monthly. Shared by the register API
// routes and (for the marker preview) the UI.

// "999x" temp-code series — newly added staff not yet on the official
// register (9991, 9992, … or any code beginning 999). Drives the "new" marker.
export const NEW_STAFF_CODE = /^999\d+$/
export function isNewStaffCode(code: string): boolean {
  return NEW_STAFF_CODE.test((code || '').trim())
}

// next month key — "2026-05" → "2026-06" (wraps Dec → next-year Jan).
export function nextMonthKey(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!m) throw new Error("Bad monthKey: " + monthKey)
  let year = parseInt(m[1], 10)
  let month = parseInt(m[2], 10) + 1
  if (month > 12) { month = 1; year += 1 }
  return `${year}-${String(month).padStart(2, '0')}`
}

export type AutoStatusInput = {
  monthKey: string
  code: string
  inactivatedMonth: string | null
  hasSalaryInc: boolean // a StaffSalaryRevision with effectiveMonth === monthKey exists
  isFirstRegisterMonth: boolean // this is the first month the staff appears
}

// Compute the auto STATUS marker for a row. Several can apply at once
// (e.g. a brand-new 999x staff who also got a raise) — joined with ", ".
// Order: deleted, new, salary inc.
export function autoStatusMarker(o: AutoStatusInput): string {
  const parts: string[] = []
  if (o.inactivatedMonth && o.inactivatedMonth === nextMonthKey(o.monthKey)) parts.push('deleted')
  if (isNewStaffCode(o.code) && o.isFirstRegisterMonth) parts.push('new')
  if (o.hasSalaryInc) parts.push('salary inc')
  return parts.join(', ')
}

// Resolve the STATUS cell shown/exported. A manual override (incl. the empty
// string, meaning "deliberately blank") always wins over the auto value.
export function resolveStatus(manual: string | null | undefined, auto: string): string {
  return manual != null ? manual : auto
}

// Shape returned by the register API for one staff row, mirroring the sheet:
// STATUS | sn | code | employee name | department | salary | perday | DAY | Amount
export type RegisterRow = {
  staffId: string
  sn: number
  code: string
  name: string
  department: string | null
  salary: number // Register Salary (monthlyBaseSalary)
  perDay: number // posted daily rate (wage entry), rounded; falls back to salary/monthDays
  days: number // DAY — daysWorked from the wage entry; 0 when none
  amount: number // posted calculatedWage (rounded); 0 when no entry / zero days
  status: string // resolved STATUS marker
  autoStatus: string // the computed marker (for the UI to show "auto" vs override)
  statusOverridden: boolean
  inRegister: boolean
}
