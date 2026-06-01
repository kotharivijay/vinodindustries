export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deleteVoucherInTally } from '@/lib/tally-delete'

const db = prisma as any

/**
 * POST /api/accounts/sales/bulk-delete
 * Body: { ids: number[] }
 *
 * Tally-first atomic flow per voucher: for each Journal id, push delete to
 * Tally and verify; only then delete the local row. Rows whose Tally delete
 * fails are kept in the DB and reported back in `failed[]` so the user can
 * retry. Non-Journal and missing ids are reported in `skipped[]`.
 *
 * Sequential per voucher — Tally tunnel is single-threaded and we want
 * clean error attribution rather than parallel speed.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(body?.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)) : []
  if (!ids.length) return NextResponse.json({ error: 'ids[] required' }, { status: 400 })

  const rows = await db.ksiSalesInvoice.findMany({
    where: { id: { in: ids } },
    select: { id: true, date: true, vchType: true, vchNumber: true, isOpeningBalance: true },
  })

  const journals = rows.filter((r: any) => r.vchType === 'Journal')
  const skipped = rows.filter((r: any) => r.vchType !== 'Journal').map((r: any) => ({
    id: r.id, vchType: r.vchType, vchNumber: r.vchNumber, reason: 'not a Journal',
  }))
  const missing = ids.filter(id => !rows.find((r: any) => r.id === id)).map(id => ({ id, reason: 'not found' }))

  let deletedCount = 0
  const failed: { id: number; vchNumber: string; reason: string }[] = []

  for (const r of journals) {
    if (!r.isOpeningBalance) {
      const tallyRes = await deleteVoucherInTally({
        firmCode: 'KSI',
        vchType: r.vchType,
        vchNumber: r.vchNumber,
        date: r.date,
      })
      if (!tallyRes.ok) {
        failed.push({ id: r.id, vchNumber: r.vchNumber, reason: tallyRes.error || 'Tally delete failed' })
        continue
      }
    }
    await db.ksiSalesInvoice.delete({ where: { id: r.id } })
    deletedCount++
  }

  return NextResponse.json({
    ok: true,
    deletedCount,
    requested: ids.length,
    skipped: [...skipped, ...missing],
    failed,
  })
}
