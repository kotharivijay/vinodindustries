import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fetchTallyLedgerBalances, parseTallyAdvance } from '@/lib/tallyPayroll'
import { computeWageRow, monthDaysFor, type WageStrategy } from '@/lib/payrollCalc'
import { fetchPreviousCarry, targetSalaryFor, computeClosingCarry } from '@/lib/payrollStaffCarry'

export const maxDuration = 300

// POST /api/payroll/wages/sync-advances
// Body: { month: 'YYYY-MM', firm?: 'KSI' (default) }
//
// For every active staff that has tallyLedgerName set, looks up its closing
// balance in the firm's Tally and writes the magnitude into the month's
// MonthlyWageEntry.staffAdvance. If the entry doesn't exist yet, it is
// created with sensible defaults (SALARY_FIRST for salaried, DAYS_FIRST
// with 0 days for contractor-linked) so the sync also doubles as "init
// month for staff with a Tally ledger".
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({})) as { month?: string; firm?: string }
    const monthKey = (body.month || '').trim()
    const firm = (body.firm || 'KSI').toUpperCase()
    if (!monthKey) return Response.json({ error: 'month is required' }, { status: 400 })

    const monthDays = monthDaysFor(monthKey)
    const t0 = Date.now()

    const balances = await fetchTallyLedgerBalances(firm)
    const staff = await prisma.staff.findMany({
      where: { isActive: true, tallyLedgerName: { not: null } },
    })

    let updated = 0, notFound = 0
    const matches: { staffId: string; staffName: string; tallyLedger: string; advance: number; found: boolean }[] = []

    let skippedLocked = 0
    for (const s of staff) {
      const ledger = s.tallyLedgerName!.trim()
      const raw = balances.get(ledger.toLowerCase())
      const found = raw !== undefined
      const advance = found ? parseTallyAdvance(raw.closing, raw.isLiability) : 0
      matches.push({ staffId: s.id, staffName: s.name, tallyLedger: ledger, advance, found })

      // Record the per-staff sync result so the wages-page row can render
      // a "NA in Tally" badge for ledgers that didn't match. Stamped on
      // EVERY pass (found and not-found) so the badge always reflects the
      // most recent sync.
      await prisma.staff.update({
        where: { id: s.id },
        data: { tallyLedgerFound: found, tallyLedgerSyncedAt: new Date() },
      })

      if (!found) { notFound++; continue }

      const existing = await prisma.monthlyWageEntry.findUnique({
        where: { staffId_monthKey: { staffId: s.id, monthKey } },
      })
      // Skip staff whose journal OR payment voucher has already been pushed
      // to Tally — the voucher is in stone, and overwriting staffAdvance now
      // would desynchronise the app from what's actually in Tally.
      if (existing && (existing.postedToTally || existing.paymentPostedToTally)) {
        skippedLocked++
        continue
      }
      // For staff who already have CONTRACTOR allocations, DO NOT recompute
      // the wage — their calculatedWage is the sum of allocation shares and
      // recomputing it from monthlyBaseSalary (especially with SALARY_FIRST
      // default) would overwrite the contractor distribution. Only update
      // staffAdvance + netPayable in that case.
      const existingAllocs = existing
        ? await prisma.wageContractorAllocation.findMany({
            where: { wageEntryId: existing.id },
            select: { share: true },
          })
        : []
      const hasContractorAllocations = existingAllocs.length > 0

      let data: Record<string, unknown>
      if (hasContractorAllocations && existing) {
        const totalShare = existingAllocs.reduce((s, a) => s + a.share, 0)
        data = {
          staffAdvance: advance,
          advanceSyncedAt: new Date(),
          netPayable: Math.max(0, totalShare - advance),
        }
      } else {
        // NO auto-fill on sync. Use existing days if any, else 0. NEVER
        // default to SALARY_FIRST (which forces wage=salary, days=monthDays).
        // The user enters days manually after sync; sync's job is the
        // advance only.
        const strategy = (existing?.strategy as WageStrategy | undefined) ?? 'DAYS_FIRST'
        const daysWorked = existing?.daysWorked ?? 0
        const actualDaysWorked = existing?.actualDaysWorked ?? null
        const calc = computeWageRow({
          monthlyBaseSalary: s.monthlyBaseSalary,
          monthDays,
          daysWorked,
          strategy,
          staffAdvance: advance,
          actualSalary: s.actualSalary,
          actualDaysWorked,
        })
        data = {
          monthDays,
          dailyRate: calc.dailyRate,
          daysWorked: calc.daysWorked,
          actualDaysWorked: calc.actualDaysWorked,
          strategy,
          calculatedWage: calc.calculatedWage,
          staffAdvance: advance,
          advanceSyncedAt: new Date(),
          netPayable: calc.netPayable,
        }
      }
      if (existing) {
        await prisma.monthlyWageEntry.update({ where: { staffId_monthKey: { staffId: s.id, monthKey } }, data })
      } else {
        await prisma.monthlyWageEntry.create({ data: { ...data, staffId: s.id, monthKey } as never })
      }

      // Recompute this staff's running carry (analogue of contractor balance).
      const fresh = await prisma.monthlyWageEntry.findUnique({
        where: { staffId_monthKey: { staffId: s.id, monthKey } },
      })
      if (fresh) {
        const wasFreshCreate = !existing
        const openingCarry = wasFreshCreate ? await fetchPreviousCarry(s.id, monthKey) : fresh.openingCarry
        const target = targetSalaryFor({
          monthlyBaseSalary: s.monthlyBaseSalary,
          actualSalary: s.actualSalary,
          actualDaysWorked: fresh.actualDaysWorked,
          monthDays,
        })
        const closingCarry = computeClosingCarry({
          openingCarry, target, calculatedWage: fresh.calculatedWage,
        })
        await prisma.monthlyWageEntry.update({
          where: { id: fresh.id },
          data: { openingCarry, closingCarry },
        })
      }
      updated++
    }

    return Response.json({
      firm, monthKey,
      staffWithLedger: staff.length,
      updated, notFound, skippedLocked,
      durationMs: Date.now() - t0,
      // Send first 20 mismatch examples back so the user can spot typos.
      missingExamples: matches.filter((m) => !m.found).slice(0, 20),
    })
  } catch (err) {
    console.error('sync-advances POST error:', err)
    return Response.json({ error: (err as Error).message || 'Sync failed' }, { status: 500 })
  }
}
