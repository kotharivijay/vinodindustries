import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeWageRow, monthDaysFor, dailyRateFor, shareFromDays, daysFromShare, type WageStrategy } from '@/lib/payrollCalc'
import { fetchPreviousCarry, targetSalaryFor, computeClosingCarry } from '@/lib/payrollStaffCarry'
import { recomputeContractorBalance } from '@/lib/payrollBalance'

// PATCH /api/payroll/wages/[staffId]?month=YYYY-MM
//
// Two modes (both can be in the same body):
//   • Standalone-style: { daysWorked, strategy, staffAdvance, notes }
//     — for staff that have NO contractor tags. Same as before.
//   • Allocation-style: { allocations: [{contractorId, share?, days?, strategy}], staffAdvance?, notes? }
//     — server upserts each allocation, derives the missing field via lib
//     helpers (Share-First: derive days; Days-First: derive share), then
//     sets the entry's calculatedWage = sum(allocations.share). Affected
//     contractors get their ContractorMonthlyBalance recomputed.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ staffId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { staffId } = await params
  const { searchParams } = new URL(request.url)
  const monthKey = (searchParams.get('month') || '').trim()
  if (!monthKey) return Response.json({ error: 'month is required' }, { status: 400 })

  const body = await request.json().catch(() => ({})) as {
    daysWorked?: number
    actualDaysWorked?: number
    strategy?: WageStrategy
    staffAdvance?: number
    notes?: string | null
    allocations?: { contractorId: string; share?: number; days?: number; strategy?: 'SHARE_FIRST' | 'DAYS_FIRST' }[]
  }

  const monthDays = monthDaysFor(monthKey)
  const staff = await prisma.staff.findUnique({ where: { id: staffId } })
  if (!staff) return Response.json({ error: 'Staff not found' }, { status: 404 })

  const dailyRate = dailyRateFor(staff.monthlyBaseSalary, monthDays)
  const existing = await prisma.monthlyWageEntry.findUnique({
    where: { staffId_monthKey: { staffId, monthKey } },
    include: { allocations: true },
  })
  const advance = body.staffAdvance ?? existing?.staffAdvance ?? 0
  const affectedContractors = new Set<string>()

  // Path 1 — allocation-based update.
  if (body.allocations && body.allocations.length > 0) {
    // Ensure the entry exists so allocations have a parent.
    const entry = existing ?? await prisma.monthlyWageEntry.create({
      data: {
        staffId, monthKey, monthDays,
        dailyRate, daysWorked: 0, strategy: 'DAYS_FIRST',
        calculatedWage: 0, staffAdvance: advance, netPayable: 0,
      },
    })

    // Upsert each incoming allocation, deriving the missing field.
    for (const a of body.allocations) {
      const strategy = a.strategy || 'SHARE_FIRST'
      let share = 0, days = 0
      if (strategy === 'SHARE_FIRST') {
        share = Number(a.share) || 0
        days = daysFromShare(share, dailyRate, monthDays)
      } else {
        days = Number(a.days) || 0
        share = shareFromDays(days, dailyRate, monthDays)
      }
      await prisma.wageContractorAllocation.upsert({
        where: { wageEntryId_contractorId: { wageEntryId: entry.id, contractorId: a.contractorId } },
        update: { share, daysWorked: days, strategy },
        create: { wageEntryId: entry.id, contractorId: a.contractorId, share, daysWorked: days, strategy },
      })
      affectedContractors.add(a.contractorId)
    }

    // Sum all allocations to set the entry's totals.
    const allAllocs = await prisma.wageContractorAllocation.findMany({
      where: { wageEntryId: entry.id },
      select: { share: true, daysWorked: true, contractorId: true },
    })
    const totalShare = allAllocs.reduce((s, a) => s + a.share, 0)
    const totalDays = allAllocs.reduce((s, a) => s + a.daysWorked, 0)
    // Also include contractors that had allocations BEFORE this PATCH (in
    // case any were removed) — they need their balance recomputed too.
    for (const a of existing?.allocations || []) affectedContractors.add(a.contractorId)

    await prisma.monthlyWageEntry.update({
      where: { id: entry.id },
      data: {
        monthDays, // keep in sync with the URL's month — guards against
                   // stale day caps in the UI from older entries.
        dailyRate,
        daysWorked: totalDays,
        calculatedWage: totalShare,
        staffAdvance: advance,
        netPayable: Math.max(0, totalShare - advance),
        notes: body.notes !== undefined ? body.notes : entry.notes,
      },
    })
  } else {
    // Path 2 — non-allocation update (advance only, or true standalone).
    // For staff who have CONTRACTOR allocations, keep calculatedWage as the
    // sum of their existing allocation shares; only update advance + net.
    // For staff with no allocations (true standalone), recompute wage from
    // days × rate via computeWageRow.
    const existingAllocs = await prisma.wageContractorAllocation.findMany({
      where: { wageEntryId: existing?.id || '' },
      select: { share: true },
    })
    const hasContractorAllocations = existingAllocs.length > 0

    let dataCommon: Record<string, unknown>
    if (hasContractorAllocations && existing) {
      const totalShare = existingAllocs.reduce((s, a) => s + a.share, 0)
      dataCommon = {
        monthDays,
        dailyRate,
        staffAdvance: advance,
        netPayable: Math.max(0, totalShare - advance),
        notes: body.notes !== undefined ? body.notes : existing.notes,
      }
    } else {
      const strategy = (body.strategy ?? (existing?.strategy as WageStrategy | undefined) ?? 'DAYS_FIRST') as WageStrategy
      const incomingDays = body.daysWorked ?? existing?.daysWorked ?? 0
      const incomingActualDays = body.actualDaysWorked !== undefined
        ? body.actualDaysWorked
        : (existing?.actualDaysWorked ?? null)
      const calc = computeWageRow({
        monthlyBaseSalary: staff.monthlyBaseSalary,
        monthDays,
        daysWorked: incomingDays,
        strategy,
        staffAdvance: advance,
        actualSalary: staff.actualSalary,
        actualDaysWorked: incomingActualDays,
      })
      dataCommon = {
        monthDays,
        dailyRate: calc.dailyRate,
        daysWorked: calc.daysWorked,
        actualDaysWorked: calc.actualDaysWorked,
        strategy,
        calculatedWage: calc.calculatedWage,
        staffAdvance: advance,
        netPayable: calc.netPayable,
        notes: body.notes !== undefined ? body.notes : (existing?.notes ?? null),
      }
    }
    if (existing) {
      await prisma.monthlyWageEntry.update({
        where: { staffId_monthKey: { staffId, monthKey } },
        data: dataCommon,
      })
    } else {
      await prisma.monthlyWageEntry.create({ data: { ...dataCommon, staffId, monthKey } })
    }
  }

  // Recompute affected contractor balances (parallel — small set).
  await Promise.all(
    Array.from(affectedContractors).map((cid) => recomputeContractorBalance(cid, monthKey))
  )

  // Recompute this staff's own running carry (analogue of contractor balance).
  // openingCarry comes from the previous month's closingCarry; on first
  // create we backfill it. closingCarry = openingCarry + target − calculatedWage.
  const fresh = await prisma.monthlyWageEntry.findUnique({
    where: { staffId_monthKey: { staffId, monthKey } },
  })
  if (fresh) {
    const wasFreshCreate = !existing
    const openingCarry = wasFreshCreate ? await fetchPreviousCarry(staffId, monthKey) : fresh.openingCarry
    const target = targetSalaryFor({
      monthlyBaseSalary: staff.monthlyBaseSalary,
      actualSalary: staff.actualSalary,
      actualDaysWorked: fresh.actualDaysWorked,
      monthDays,
    })
    const closingCarry = computeClosingCarry({
      openingCarry,
      target,
      calculatedWage: fresh.calculatedWage,
    })
    await prisma.monthlyWageEntry.update({
      where: { id: fresh.id },
      data: { openingCarry, closingCarry },
    })
  }

  const updated = await prisma.monthlyWageEntry.findUnique({
    where: { staffId_monthKey: { staffId, monthKey } },
    include: { allocations: { include: { contractor: { select: { id: true, name: true } } } } },
  })
  return Response.json(updated)
}
