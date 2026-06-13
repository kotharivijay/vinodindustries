import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { currentMonthKey, monthDaysFor, computeWageRow, type WageStrategy } from '@/lib/payrollCalc'
import { targetSalaryFor } from '@/lib/payrollStaffCarry'

export const dynamic = 'force-dynamic'


// GET /api/payroll/wages?month=YYYY-MM
// Returns one row per active staff (joined with the wage entry for that
// month if it exists), each row carrying:
//   contractors[]  — the staff's tagged contractors (drives UI sectioning)
//   allocations[]  — per-contractor share/days; empty list = no allocations yet
// Plus a top-level contractorBalances map keyed by contractor id, with each
// balance's openingCarry / jobsTotal / distributed / closingCarry and the
// list of process jobs that contractor did in the month.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const monthKey = (searchParams.get('month') || currentMonthKey()).trim()
  const monthDays = monthDaysFor(monthKey)

  const [staff, entries, allBalances, allJobs, allTemplates] = await Promise.all([
    prisma.staff.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }],
      include: {
        staffContractors: { include: { contractor: { select: { id: true, name: true } } } },
      },
    }),
    prisma.monthlyWageEntry.findMany({
      where: { monthKey },
      include: {
        allocations: {
          include: { contractor: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.contractorMonthlyBalance.findMany({
      where: { monthKey },
      include: { contractor: { select: { id: true, name: true, hiddenInWages: true } } },
    }),
    prisma.contractorProcessJob.findMany({
      where: { monthKey },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.contractorJobTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  ])
  const byStaff = new Map(entries.map((e) => [e.staffId, e]))

  const rows = staff.map((s) => {
    const e = byStaff.get(s.id)
    const contractors = s.staffContractors.map((sc) => ({ id: sc.contractor.id, name: sc.contractor.name }))
    const allocations = (e?.allocations || []).map((a) => ({
      contractorId: a.contractorId,
      contractorName: a.contractor.name,
      share: a.share,
      daysWorked: a.daysWorked,
      strategy: a.strategy,
    }))
    // Per-staff carry / target / diff (analogue of contractor balance).
    const target = targetSalaryFor({
      monthlyBaseSalary: s.monthlyBaseSalary,
      actualSalary: s.actualSalary,
      actualDaysWorked: e?.actualDaysWorked ?? null,
      monthDays: e?.monthDays || monthDays,
    })
    const calcWage = e?.calculatedWage || 0
    const openingCarry = e?.openingCarry || 0
    // closingCarry may be stale if the row was saved before carry tracking
    // existed; recompute it on read for safety.
    const closingCarry = openingCarry + target - calcWage
    const diff = target - calcWage
    return {
      staffId: s.id,
      code: s.code,
      name: s.name,
      department: s.department,
      paymentMode: s.paymentMode,
      contractors,
      allocations,
      tallyLedgerName: s.tallyLedgerName,
      tallyLedgerFound: s.tallyLedgerFound,
      tallyLedgerSyncedAt: s.tallyLedgerSyncedAt,
      inRegister: s.inRegister,
      monthlyBaseSalary: s.monthlyBaseSalary,
      actualSalary: s.actualSalary,
      entryId: e?.id || null,
      monthDays: e?.monthDays || monthDays,
      dailyRate: e?.dailyRate || 0,
      daysWorked: e?.daysWorked ?? null,
      actualDaysWorked: e?.actualDaysWorked ?? null,
      strategy: (e?.strategy as WageStrategy) || 'DAYS_FIRST',
      calculatedWage: calcWage,
      target,
      diff,
      openingCarry,
      closingCarry,
      staffAdvance: e?.staffAdvance || 0,
      advanceSyncedAt: e?.advanceSyncedAt || null,
      netPayable: e?.netPayable || 0,
      postedToTally: e?.postedToTally || false,
      postedAt: e?.postedAt || null,
      journalNo: e?.journalNo || null,
      paymentPostedToTally: e?.paymentPostedToTally || false,
      paymentPostedAt: e?.paymentPostedAt || null,
      paymentVoucherNo: e?.paymentVoucherNo || null,
      notes: e?.notes || null,
    }
  })

  // Build contractor balances map. Include balances for contractors that
  // staff are tagged to even if no balance row exists yet (defaults).
  // jobTemplates carries the per-contractor default rows the UI surfaces
  // as auto-filled rows in the job editor.
  // Fetch hiddenInWages flag for every contractor we'll surface — keeps
  // the bucket merge below simple (no extra round-trips per ID).
  const allContractors = await prisma.contractor.findMany({
    select: { id: true, name: true, hiddenInWages: true },
  })
  const contractorMeta = new Map(allContractors.map((c) => [c.id, c]))

  const contractorBalances: Record<string, {
    contractorId: string
    contractorName: string
    hiddenInWages: boolean
    openingCarry: number
    jobsTotal: number
    distributed: number
    closingCarry: number
    jobs: { id: string; processName: string; quality: string | null; rate: number; quantity: number; total: number; notes: string | null }[]
    jobTemplates: { id: string; processName: string; quality: string | null; rate: number }[]
  }> = {}
  const templatesByContractor = new Map<string, typeof allTemplates>()
  for (const t of allTemplates) {
    const arr = templatesByContractor.get(t.contractorId) || []
    arr.push(t); templatesByContractor.set(t.contractorId, arr)
  }
  const mapTemplates = (cid: string) => (templatesByContractor.get(cid) || []).map((t) => ({
    id: t.id, processName: t.processName, quality: t.quality, rate: t.rate,
  }))
  for (const b of allBalances) {
    contractorBalances[b.contractorId] = {
      contractorId: b.contractorId,
      contractorName: b.contractor.name,
      hiddenInWages: contractorMeta.get(b.contractorId)?.hiddenInWages || false,
      openingCarry: b.openingCarry,
      jobsTotal: b.jobsTotal,
      distributed: b.distributed,
      closingCarry: b.closingCarry,
      jobs: [],
      jobTemplates: mapTemplates(b.contractorId),
    }
  }
  // Add jobs to their contractor balance bucket; create the bucket if
  // there's no balance row yet.
  const jobsByContractor = new Map<string, typeof allJobs>()
  for (const j of allJobs) {
    const arr = jobsByContractor.get(j.contractorId) || []
    arr.push(j); jobsByContractor.set(j.contractorId, arr)
  }
  for (const [cid, jobs] of jobsByContractor) {
    if (!contractorBalances[cid]) {
      const meta = contractorMeta.get(cid)
      contractorBalances[cid] = {
        contractorId: cid,
        contractorName: meta?.name || '?',
        hiddenInWages: meta?.hiddenInWages || false,
        openingCarry: 0,
        jobsTotal: jobs.reduce((s, j) => s + j.total, 0),
        distributed: 0,
        closingCarry: jobs.reduce((s, j) => s + j.total, 0),
        jobs: [],
        jobTemplates: mapTemplates(cid),
      }
    }
    contractorBalances[cid].jobs = jobs.map((j) => ({
      id: j.id, processName: j.processName, quality: j.quality,
      rate: j.rate, quantity: j.quantity, total: j.total, notes: j.notes,
    }))
  }
  // Also ensure every contractor any staff is tagged to has a balance bucket
  // (even if empty) so the UI can render the section.
  for (const r of rows) {
    for (const c of r.contractors) {
      if (!contractorBalances[c.id]) {
        contractorBalances[c.id] = {
          contractorId: c.id, contractorName: c.name,
          hiddenInWages: contractorMeta.get(c.id)?.hiddenInWages || false,
          openingCarry: 0, jobsTotal: 0, distributed: 0, closingCarry: 0,
          jobs: [],
          jobTemplates: mapTemplates(c.id),
        }
      }
    }
  }

  const totals = rows.reduce(
    (a, r) => ({
      budget: a.budget + r.monthlyBaseSalary,
      calculated: a.calculated + r.calculatedWage,
      netPayable: a.netPayable + r.netPayable,
      advance: a.advance + r.staffAdvance,
      withEntry: a.withEntry + (r.entryId ? 1 : 0),
      posted: a.posted + (r.postedToTally ? 1 : 0),
    }),
    { budget: 0, calculated: 0, netPayable: 0, advance: 0, withEntry: 0, posted: 0 }
  )

  return Response.json({ monthKey, monthDays, rows, totals, contractorBalances })
}

// POST /api/payroll/wages
// Bulk "Calculate All Wages" — creates an EMPTY MonthlyWageEntry for every
// active staff that doesn't already have one for this month. No auto-fill:
// daysWorked starts at 0, strategy is DAYS_FIRST, calculatedWage is 0.
// The user enters days/share manually. Existing entries are NOT touched.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { month?: string }
  const monthKey = (body.month || currentMonthKey()).trim()
  const monthDays = monthDaysFor(monthKey)

  const [staff, existing] = await Promise.all([
    prisma.staff.findMany({ where: { isActive: true } }),
    prisma.monthlyWageEntry.findMany({ where: { monthKey }, select: { staffId: true } }),
  ])
  const have = new Set(existing.map((e) => e.staffId))

  const toCreate = staff.filter((s) => !have.has(s.id)).map((s) => {
    const calc = computeWageRow({
      monthlyBaseSalary: s.monthlyBaseSalary,
      monthDays,
      daysWorked: 0,
      strategy: 'DAYS_FIRST',
      staffAdvance: 0,
      actualSalary: s.actualSalary,
      actualDaysWorked: s.actualSalary ? 0 : null,
    })
    return {
      staffId: s.id,
      monthKey,
      monthDays,
      dailyRate: calc.dailyRate,
      daysWorked: calc.daysWorked,
      actualDaysWorked: calc.actualDaysWorked,
      strategy: 'DAYS_FIRST',
      calculatedWage: calc.calculatedWage,
      staffAdvance: 0,
      netPayable: calc.netPayable,
    }
  })

  if (toCreate.length > 0) {
    await prisma.monthlyWageEntry.createMany({ data: toCreate, skipDuplicates: true })
  }
  return Response.json({ created: toCreate.length, alreadyExisted: have.size })
}
