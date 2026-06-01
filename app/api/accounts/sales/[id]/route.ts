export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { deleteVoucherInTally } from '@/lib/tally-delete'

const db = prisma as any

/**
 * DELETE /api/accounts/sales/[id]
 *
 * Hard-deletes a KsiSalesInvoice — currently restricted to vchType=Journal
 * so the operator can clean up TDS/discount journals without touching real
 * Tally-synced Sales / Process Job / Credit Note rows.
 *
 * Tally-first atomic flow: pushes a delete to Tally, verifies the voucher
 * is actually gone (Tally's IMPORTRESULT counters lie), and only then
 * deletes the local row. If Tally delete fails, the DB row is preserved
 * so the user can retry without orphans.
 *
 * Opening-balance rows (isOpeningBalance=true) skip the Tally step since
 * they never lived in Tally.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const existing = await db.ksiSalesInvoice.findUnique({
    where: { id },
    select: { id: true, date: true, vchType: true, vchNumber: true, partyName: true, totalAmount: true, isOpeningBalance: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.vchType !== 'Journal') {
    return NextResponse.json({
      error: `Only Journal vouchers can be deleted here (this one is "${existing.vchType}"). Delete it in Tally and re-sync if needed.`,
    }, { status: 409 })
  }

  let tallyNote = ''
  if (!existing.isOpeningBalance) {
    const tallyRes = await deleteVoucherInTally({
      firmCode: 'KSI',
      vchType: existing.vchType,
      vchNumber: existing.vchNumber,
      date: existing.date,
    })
    if (!tallyRes.ok) {
      return NextResponse.json({
        error: `Tally delete failed: ${tallyRes.error}. Local row was NOT deleted.`,
        tally: tallyRes,
      }, { status: 502 })
    }
    tallyNote = tallyRes.alreadyAbsent
      ? 'Voucher was not in Tally (already absent). Local row deleted.'
      : 'Deleted from Tally and verified absent, then local row deleted.'
  } else {
    tallyNote = 'Manual opening-balance row — no Tally push needed.'
  }

  await db.ksiSalesInvoice.delete({ where: { id } })

  return NextResponse.json({
    ok: true,
    deleted: { id, vchType: existing.vchType, vchNumber: existing.vchNumber, partyName: existing.partyName, totalAmount: existing.totalAmount },
    note: tallyNote,
  })
}
