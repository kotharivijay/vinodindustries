export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * POST /api/accounts/sales/bulk-delete
 * Body: { ids: number[] }
 *
 * Hard-deletes multiple KsiSalesInvoice rows in one shot. Same Journal-only
 * guard as the single DELETE endpoint — anything else in the list is skipped
 * and reported back so the operator knows why a row stayed.
 *
 * No allocation guard (matches single delete) — receipt allocations cascade.
 * Synced rows will re-appear on the next sales-sync unless deleted in Tally.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(body?.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)) : []
  if (!ids.length) return NextResponse.json({ error: 'ids[] required' }, { status: 400 })

  const rows = await db.ksiSalesInvoice.findMany({
    where: { id: { in: ids } },
    select: { id: true, vchType: true, vchNumber: true, isOpeningBalance: true },
  })

  const journalIds = rows.filter((r: any) => r.vchType === 'Journal').map((r: any) => r.id)
  const skipped = rows.filter((r: any) => r.vchType !== 'Journal').map((r: any) => ({
    id: r.id, vchType: r.vchType, vchNumber: r.vchNumber, reason: 'not a Journal',
  }))
  const missing = ids.filter(id => !rows.find((r: any) => r.id === id)).map(id => ({ id, reason: 'not found' }))

  let deletedCount = 0
  if (journalIds.length) {
    const result = await db.ksiSalesInvoice.deleteMany({ where: { id: { in: journalIds } } })
    deletedCount = result.count
  }

  const hasSyncedDeleted = rows.some((r: any) => r.vchType === 'Journal' && !r.isOpeningBalance)

  return NextResponse.json({
    ok: true,
    deletedCount,
    requested: ids.length,
    skipped: [...skipped, ...missing],
    note: hasSyncedDeleted
      ? 'Some deleted rows were Tally-synced. A future sales-sync will RE-CREATE them from Tally. Delete in Tally too to make this permanent.'
      : undefined,
  })
}
