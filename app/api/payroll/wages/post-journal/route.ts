import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { postWageJournal } from '@/lib/tallyPayroll'
import { monthDaysFor } from '@/lib/payrollCalc'

export const maxDuration = 300
export const dynamic = 'force-dynamic'


// Build the journal payload — shared by preview + push.
// One Dr leg (wages ledger) summing all calculated wages; one Cr leg per
// staff (calculated wage credited to their ledger). Net payable shown in
// the UI is wage − advance — informational; the journal posts the FULL
// wage so the staff ledger nets to the correct outstanding balance after.
async function buildPayload(monthKey: string, firm: string, entryIds?: string[]) {
  const monthDays = monthDaysFor(monthKey)
  const whereClause: any = { monthKey, postedToTally: false, calculatedWage: { gt: 0 } }
  if (entryIds && entryIds.length > 0) {
    whereClause.id = { in: entryIds }
  }

  const entries = await prisma.monthlyWageEntry.findMany({
    where: whereClause,
    include: { staff: { select: { id: true, name: true, code: true, tallyLedgerName: true } } },
    orderBy: { staff: { name: 'asc' } },
  })

  const skipped: { staffId: string; staffName: string; reason: string }[] = []
  const legs: { entryId: string; staffId: string; staffName: string; staffLedger: string; amount: number }[] = []
  for (const e of entries) {
    if (!e.staff.tallyLedgerName?.trim()) {
      skipped.push({ staffId: e.staff.id, staffName: e.staff.name, reason: 'No tallyLedgerName on staff' })
      continue
    }
    legs.push({
      entryId: e.id,
      staffId: e.staff.id,
      staffName: e.staff.name,
      staffLedger: e.staff.tallyLedgerName.trim(),
      amount: Math.round(e.calculatedWage * 100) / 100,
    })
  }
  const total = legs.reduce((s, l) => s + l.amount, 0)
  return { firm, monthKey, monthDays, legs, skipped, total }
}

// GET /api/payroll/wages/post-journal?month=YYYY-MM&firm=KSI&entryIds=id1,id2
// Preview only — no push, no DB writes.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const monthKey = (searchParams.get('month') || '').trim()
    const firm = (searchParams.get('firm') || 'KSI').toUpperCase()
    if (!monthKey) return Response.json({ error: 'month is required' }, { status: 400 })

    const entryIdsStr = searchParams.get('entryIds')
    const entryIds = entryIdsStr ? entryIdsStr.split(',').filter(Boolean) : undefined

    const payload = await buildPayload(monthKey, firm, entryIds)
    return Response.json(payload)
  } catch (err) {
    console.error('post-journal GET error:', err)
    return Response.json({ error: (err as Error).message || 'Failed to build preview' }, { status: 500 })
  }
}

// POST /api/payroll/wages/post-journal
// Body: { month, firm?, entryIds?, voucherDate? (YYYY-MM-DD), wagesLedger?, narration? }
// Pushes a single Journal voucher to Tally and marks all included
// MonthlyWageEntry rows as posted (with the Tally voucher id).
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({})) as {
      month?: string
      firm?: string
      entryIds?: string[]
      voucherDate?: string // YYYY-MM-DD
      wagesLedger?: string
      narration?: string
    }
    const monthKey = (body.month || '').trim()
    const firm = (body.firm || 'KSI').toUpperCase()
    if (!monthKey) return Response.json({ error: 'month is required' }, { status: 400 })

    const payload = await buildPayload(monthKey, firm, body.entryIds)
    if (payload.legs.length === 0) {
      return Response.json({ error: 'No postable rows', skipped: payload.skipped }, { status: 400 })
    }

    // Default voucher date = 7th of NEXT month (typical payroll cut-off).
    // Matches the post-payment default so journal + payment land on the
    // same accounting date by default.
    const defaultDate = (() => {
      const [y, m] = monthKey.split('-').map(Number)
      const nextY = m === 12 ? y + 1 : y
      const nextM = m === 12 ? 1 : m + 1
      return `${nextY}${String(nextM).padStart(2, '0')}07`
    })()
    const voucherDate = body.voucherDate
      ? body.voucherDate.replace(/-/g, '')
      : defaultDate

    const wagesLedger = (body.wagesLedger || 'WAGES AND SALARY').trim()
    const narration = (body.narration || `Wages and salary — ${monthKey}`).trim()

    const result = await postWageJournal(firm, {
      voucherDateYYYYMMDD: voucherDate,
      wagesLedger,
      narration,
      legs: payload.legs.map((l) => ({ staffLedger: l.staffLedger, amount: l.amount, staffName: l.staffName })),
    })

    // Map results back to entryIds via staffLedger so each entry gets its
    // OWN journal voucher id (since we now post one voucher per staff).
    const ledgerToEntry = new Map(payload.legs.map((l) => [l.staffLedger, l]))
    const now = new Date()
    const failedDetails: { staffLedger: string; error?: string }[] = []
    for (const r of result.results) {
      if (!r.ok) {
        failedDetails.push({ staffLedger: r.staffLedger, error: r.error })
        continue
      }
      const leg = ledgerToEntry.get(r.staffLedger)
      if (!leg) continue
      await prisma.monthlyWageEntry.update({
        where: { id: leg.entryId },
        data: { postedToTally: true, postedAt: now, journalNo: r.vchId || `mvch:${voucherDate}` },
      })
    }

    return Response.json({
      ok: result.failedCount === 0,
      firm, monthKey, voucherDate,
      wagesLedger, narration,
      posted: result.postedCount,
      failed: result.failedCount,
      failedDetails,
      total: payload.total,
      skipped: payload.skipped,
    })
  } catch (err) {
    console.error('post-journal POST error:', err)
    return Response.json({ error: (err as Error).message || 'Post failed' }, { status: 500 })
  }
}
