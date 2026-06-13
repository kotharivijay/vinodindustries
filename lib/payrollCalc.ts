// Wage calculation helpers shared by /api/payroll/wages and the UI.
//
// Daily rate model (matches the register's "J1" column convention):
//   dailyRate = round(monthlyBaseSalary / monthDays)
// We round to the nearest integer because the firm's printed register
// shows whole rupees and the user reconciles to that number.
//
// Two calculation strategies:
//   • DAYS_FIRST   — user enters daysWorked; wage = dailyRate × daysWorked.
//   • SALARY_FIRST — wage should hit monthlyBaseSalary as closely as
//     possible; we pick daysWorked rounded to the nearest 0.5 increment
//     that minimises |wage − salary|.
//   • SYNC         — placeholder for future contractor-process based
//     calculations; today we route it through DAYS_FIRST math.

export const PAYMENT_MODES = ['SALARIED', 'CONTRACTOR_LINKED'] as const
export type PaymentMode = (typeof PAYMENT_MODES)[number]

export const WAGE_STRATEGIES = ['DAYS_FIRST', 'SALARY_FIRST', 'SYNC'] as const
export type WageStrategy = (typeof WAGE_STRATEGIES)[number]

// Days in a calendar month for the YYYY-MM key. Returns 28-31.
export function monthDaysFor(monthKey: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!m) throw new Error(`Bad monthKey: ${monthKey}`)
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  // Day 0 of next month = last day of current month
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function currentMonthKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// Daily rate as exact float so wage math (dailyRate × monthDays) stays
// equal to the monthlyBaseSalary. Earlier this was Math.round(), which
// caused ₹6–₹15 drift per staff (e.g. 32000/31 = 1032.258 → rounded to
// 1032 → 1032 × 31 = 31992, off by ₹8). UI rounds for display via
// fmtDailyRate(); math always uses the float.
export function dailyRateFor(monthlyBaseSalary: number, monthDays: number): number {
  if (!monthDays) return 0
  return monthlyBaseSalary / monthDays
}

// Display helper — 2 decimals if non-integer, else integer.
export function fmtDailyRate(n: number): string {
  if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n))
  return n.toFixed(2)
}

// Pick the 0.5-step daysWorked that gets the wage closest to monthlyBaseSalary.
// Returns daysWorked + the resulting wage + diff.
export function salaryFirstSolve(monthlyBaseSalary: number, dailyRate: number, monthDays: number): { daysWorked: number; calculatedWage: number; diff: number } {
  if (dailyRate <= 0) return { daysWorked: 0, calculatedWage: 0, diff: monthlyBaseSalary }
  const target = monthlyBaseSalary / dailyRate
  // Search around the analytical answer at 0.5 step. Pin to [0, monthDays].
  const candidates = new Set<number>()
  for (let offset = -2; offset <= 2; offset++) {
    const base = Math.round(target * 2) / 2 + offset * 0.5
    if (base >= 0 && base <= monthDays) candidates.add(base)
  }
  candidates.add(monthDays) // always consider a "full month" — common best answer
  let best = monthDays
  let bestDiff = Number.POSITIVE_INFINITY
  for (const d of candidates) {
    const wage = dailyRate * d
    const diff = Math.abs(monthlyBaseSalary - wage)
    if (diff < bestDiff) { bestDiff = diff; best = d }
  }
  const calculatedWage = dailyRate * best
  return { daysWorked: best, calculatedWage, diff: monthlyBaseSalary - calculatedWage }
}

// Snap a free-form day count to the nearest 0.5 increment within [0, monthDays].
export function snapDays(days: number, monthDays: number): number {
  const snapped = Math.round(days * 2) / 2
  if (snapped < 0) return 0
  if (snapped > monthDays) return monthDays
  return snapped
}

// ── Contractor-process model helpers ────────────────────────────
// Used by /api/payroll/wages/[staffId] PATCH and the WagesClient UI
// for the per-allocation Share↔Days conversions.

// Days entered → share earned. Pure: just snaps days and multiplies.
export function shareFromDays(days: number, dailyRate: number, monthDays: number): number {
  return dailyRate * snapDays(days, monthDays)
}

// Share entered → days needed to hit that share at the given daily rate,
// snapped to the nearest 0.5. Clamped to [0, monthDays]. Returns 0 if
// dailyRate is non-positive (staff has no register salary).
export function daysFromShare(share: number, dailyRate: number, monthDays: number): number {
  if (dailyRate <= 0 || share <= 0) return 0
  return snapDays(share / dailyRate, monthDays)
}

// Recompute a contractor's monthly balance from raw inputs.
// closingCarry = openingCarry + jobsTotal − distributed (no rounding —
// carry can drift by fractions across months and that's fine).
export function recomputeBalance(opts: {
  openingCarry: number
  jobs: { total: number }[]
  allocations: { share: number }[]
}): { jobsTotal: number; distributed: number; closingCarry: number } {
  const jobsTotal = opts.jobs.reduce((s, j) => s + (j.total || 0), 0)
  const distributed = opts.allocations.reduce((s, a) => s + (a.share || 0), 0)
  const closingCarry = (opts.openingCarry || 0) + jobsTotal - distributed
  return { jobsTotal, distributed, closingCarry }
}

// Return previous-month key. "2026-05" → "2026-04". Wraps Jan to prev-year-Dec.
export function previousMonthKey(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!m) throw new Error("Bad monthKey: " + monthKey)
  let year = parseInt(m[1], 10)
  let month = parseInt(m[2], 10) - 1
  if (month < 1) { month = 12; year -= 1 }
  return `${year}-${String(month).padStart(2, '0')}`
}

// Compute the wage + netPayable for a row given user inputs. Returns the
// fields that should be persisted to MonthlyWageEntry.
export function computeWageRow(opts: {
  monthlyBaseSalary: number
  monthDays: number
  daysWorked: number
  strategy: WageStrategy
  staffAdvance: number
  actualSalary?: number | null
  actualDaysWorked?: number | null
}): {
  dailyRate: number
  daysWorked: number
  actualDaysWorked: number | null
  calculatedWage: number
  netPayable: number
  diff: number // salary - calculatedWage (positive => underpaid vs salary target)
} {
  const dailyRate = dailyRateFor(opts.monthlyBaseSalary, opts.monthDays)

  if (opts.actualSalary != null && opts.actualSalary > 0) {
    // Register days drive the wage. Actual days drive the (informational)
    // target salary only — they do NOT recompute register days here.
    const daysWorked = snapDays(opts.daysWorked, opts.monthDays)
    const actDaysWorked = opts.actualDaysWorked != null
      ? snapDays(opts.actualDaysWorked, opts.monthDays)
      : opts.monthDays
    const calculatedWage = dailyRate * daysWorked
    const netPayable = Math.max(0, calculatedWage - (opts.staffAdvance || 0))

    return {
      dailyRate,
      daysWorked,
      actualDaysWorked: actDaysWorked,
      calculatedWage,
      netPayable,
      diff: opts.monthlyBaseSalary - calculatedWage,
    }
  }

  let daysWorked = snapDays(opts.daysWorked, opts.monthDays)
  let calculatedWage = dailyRate * daysWorked
  if (opts.strategy === 'SALARY_FIRST') {
    const s = salaryFirstSolve(opts.monthlyBaseSalary, dailyRate, opts.monthDays)
    daysWorked = s.daysWorked
    calculatedWage = s.calculatedWage
  }
  const netPayable = Math.max(0, calculatedWage - (opts.staffAdvance || 0))
  return {
    dailyRate,
    daysWorked,
    actualDaysWorked: null,
    calculatedWage,
    netPayable,
    diff: opts.monthlyBaseSalary - calculatedWage,
  }
}
