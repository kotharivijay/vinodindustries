import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST /api/payroll/wages/reset-posted
// Body: { entryIds: string[], kind: 'journal' | 'payment' | 'both' }
//
// Clears the posted flags on MonthlyWageEntry rows so the user can repost
// them — typically after manually deleting the corresponding voucher(s)
// inside Tally. Does NOT touch Tally; only resets the app-side bookkeeping.
//
// kind = 'journal' → clears postedToTally / postedAt / journalNo
// kind = 'payment' → clears paymentPostedToTally / paymentPostedAt /
//                    paymentVoucherNo
// kind = 'both'    → clears both sets
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    entryIds?: string[]
    kind?: 'journal' | 'payment' | 'both'
  }
  const ids = (body.entryIds || []).filter(Boolean)
  if (ids.length === 0) return Response.json({ error: 'entryIds is required' }, { status: 400 })
  const kind = body.kind || 'journal'

  const data: Record<string, unknown> = {}
  if (kind === 'journal' || kind === 'both') {
    data.postedToTally = false
    data.postedAt = null
    data.journalNo = null
  }
  if (kind === 'payment' || kind === 'both') {
    data.paymentPostedToTally = false
    data.paymentPostedAt = null
    data.paymentVoucherNo = null
  }

  const result = await prisma.monthlyWageEntry.updateMany({
    where: { id: { in: ids } },
    data,
  })
  return Response.json({ ok: true, reset: result.count, kind })
}
