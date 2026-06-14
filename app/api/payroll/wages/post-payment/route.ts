import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { postWagePayments } from '@/lib/tallyPayroll'
import { monthDaysFor } from '@/lib/payrollCalc'
import { randomUUID } from 'node:crypto'

export const maxDuration = 300
export const dynamic = 'force-dynamic'


async function buildPayload(monthKey: string, firm: string, entryIds?: string[]) {
  const monthDays = monthDaysFor(monthKey)
  
  const whereClause: any = {
    monthKey,
    paymentPostedToTally: false,
    netPayable: { gt: 0 }
  }
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
      amount: Math.round(e.netPayable), // whole rupee — matches what's posted
    })
  }
  const total = legs.reduce((s, l) => s + l.amount, 0)
  return { firm, monthKey, monthDays, legs, skipped, total }
}

// GET /api/payroll/wages/post-payment?month=YYYY-MM&firm=KSI&entryIds=id1,id2
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const monthKey = (searchParams.get('month') || '').trim()
  const firm = (searchParams.get('firm') || 'KSI').toUpperCase()
  if (!monthKey) return Response.json({ error: 'month is required' }, { status: 400 })

  const entryIdsStr = searchParams.get('entryIds')
  const entryIds = entryIdsStr ? entryIdsStr.split(',').filter(Boolean) : undefined

  const payload = await buildPayload(monthKey, firm, entryIds)
  return Response.json(payload)
}

// POST /api/payroll/wages/post-payment
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    month?: string
    firm?: string
    entryIds?: string[]
    voucherDate?: string // YYYY-MM-DD
    bankLedger?: string
    narration?: string
    bankDetails?: Record<string, { accountNumber: string; ifsc: string; bankName: string }>
  }
  const monthKey = (body.month || '').trim()
  const firm = (body.firm || 'KSI').toUpperCase()
  if (!monthKey) return Response.json({ error: 'month is required' }, { status: 400 })

  const payload = await buildPayload(monthKey, firm, body.entryIds)
  if (payload.legs.length === 0) {
    return Response.json({ error: 'No postable rows', skipped: payload.skipped }, { status: 400 })
  }

  // Default = today (the bank transaction actually happens today).
  // Journal default stays "7th of next month" — they post on different
  // accounting dates.
  const defaultDate = (() => {
    const t = new Date()
    return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`
  })()

  const voucherDate = body.voucherDate
    ? body.voucherDate.replace(/-/g, '')
    : defaultDate

  const bankLedger = (body.bankLedger || 'HDFC BANK').trim()
  const narration = (body.narration || `Wages payment — ${monthKey}`).trim()

  const payments = payload.legs.map((l) => {
    const b = body.bankDetails?.[l.staffLedger.toLowerCase().trim()] || { accountNumber: '', ifsc: '', bankName: '' }
    const uniqueRefNo = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10)
    const allocationName = randomUUID()

    return {
      staffLedger: l.staffLedger,
      amount: l.amount,
      accNumber: b.accountNumber || '',
      ifscCode: b.ifsc || '',
      bankName: b.bankName || '',
      uniqueRefNo,
      allocationName,
    }
  })

  const result = await postWagePayments(firm, {
    voucherDateYYYYMMDD: voucherDate,
    bankLedger,
    narration,
    payments,
  })

  if (!result.ok) {
    return Response.json({
      error: 'Tally rejected the payments',
      created: result.created, errors: result.errors, exceptions: result.exceptions,
      raw: result.raw.slice(0, 600),
    }, { status: 502 })
  }

  const paymentVoucherNo = result.lastVchId || `pvch:${voucherDate}`
  const now = new Date()
  await prisma.monthlyWageEntry.updateMany({
    where: { id: { in: payload.legs.map((l) => l.entryId) } },
    data: { paymentPostedToTally: true, paymentPostedAt: now, paymentVoucherNo },
  })

  return Response.json({
    ok: true,
    firm, monthKey, voucherDate,
    bankLedger, narration,
    paymentVoucherNo,
    posted: payload.legs.length,
    total: payload.total,
    skipped: payload.skipped,
  })
}
