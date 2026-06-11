export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * GET /api/maintenance/duplicate-receipts
 *
 * Finds KsiHdfcReceipt rows that share the same NEFT/UPI bank reference
 * (`bankRef`, populated from BANKALLOCATIONS.UNIQUEREFERENCENUMBER on
 * sync). Same bank ref = same on-wire transaction, so two rows with the
 * same `bankRef` are the same money showing up twice — usually because
 * the user re-created a Receipt voucher in Tally and forgot to delete
 * the first one.
 *
 * Returns: groups of 2+ rows, each row tagged removable (no allocations
 * and no refund Payments pointing at it) or keeper (has either). A
 * removable row can be deleted without breaking any link. If every row
 * in a group is a keeper the group surfaces for manual review but no
 * delete button is offered for it.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dupRefs = await db.ksiHdfcReceipt.groupBy({
    by: ['bankRef'],
    where: { bankRef: { not: null } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  })

  const refs: string[] = dupRefs.map((r: any) => r.bankRef).filter(Boolean)
  if (refs.length === 0) return NextResponse.json({ groups: [] })

  const rows = await db.ksiHdfcReceipt.findMany({
    where: { bankRef: { in: refs } },
    select: {
      id: true, date: true, vchNumber: true, vchType: true, partyName: true,
      amount: true, direction: true, narration: true, bankRef: true,
      hidden: true, tallyPushedAt: true,
      allocations: { select: { id: true } },
      refunds: { select: { id: true } },
    },
    orderBy: [{ bankRef: 'asc' }, { id: 'asc' }],
  })

  const byRef = new Map<string, any[]>()
  for (const r of rows) {
    const list = byRef.get(r.bankRef!) || []
    list.push({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      vchNumber: r.vchNumber,
      vchType: r.vchType,
      partyName: r.partyName,
      amount: Number(r.amount || 0),
      direction: r.direction,
      narration: r.narration,
      hidden: r.hidden,
      tallyPushedAt: r.tallyPushedAt,
      allocationCount: r.allocations.length,
      refundCount: r.refunds.length,
      removable: r.allocations.length === 0 && r.refunds.length === 0,
    })
    byRef.set(r.bankRef!, list)
  }

  // Build groups; remove any that don't have at least one keeper. A
  // group with all-removable rows would mean ALL twins are unallocated —
  // we'd be picking blind which to keep. Leave those for manual review
  // (they show up but the bulk-delete count excludes them).
  const groups = [...byRef.entries()].map(([bankRef, items]) => {
    const keepers = items.filter(r => !r.removable).length
    return { bankRef, rows: items, keeperCount: keepers, removableCount: items.length - keepers }
  })
  // Sort: groups with safe deletes first, then larger groups
  groups.sort((a, b) => {
    const aSafe = a.keeperCount > 0 && a.removableCount > 0 ? 1 : 0
    const bSafe = b.keeperCount > 0 && b.removableCount > 0 ? 1 : 0
    if (aSafe !== bSafe) return bSafe - aSafe
    return b.rows.length - a.rows.length
  })

  const stats = {
    groupCount: groups.length,
    totalRows: groups.reduce((s, g) => s + g.rows.length, 0),
    safeDeletes: groups.reduce((s, g) => s + (g.keeperCount > 0 ? g.removableCount : 0), 0),
    unsafeGroups: groups.filter(g => g.keeperCount === 0).length,
  }

  return NextResponse.json({ groups, stats })
}

/**
 * POST /api/maintenance/duplicate-receipts
 * Body: { ids: number[] }
 *
 * Deletes the receipts whose ids are listed, but ONLY if at the moment
 * of delete each row:
 *   1. Has a non-null bankRef,
 *   2. Has a sibling row with the same bankRef that is NOT being deleted,
 *   3. Has zero KsiReceiptAllocation rows,
 *   4. Has zero refund KsiHdfcReceipt rows pointing at it.
 *
 * Any id that fails one of these is skipped and listed in the response.
 * No partial state: each delete is its own check + delete; failures
 * don't roll back successful deletes.
 *
 * Caveat: receipts pulled by the periodic ksi-hdfc-sync are upserted on
 * (vchNumber, date, vchType). A hard delete here returns IFF the dupe
 * still exists in Tally; the next sync re-creates it. For permanent
 * removal the operator must also delete the dupe voucher in Tally Prime.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(body.ids)
    ? body.ids.map((n: any) => Number(n)).filter(Number.isFinite)
    : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids[] required' }, { status: 400 })

  const idSet = new Set(ids)
  const targets = await db.ksiHdfcReceipt.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, bankRef: true,
      allocations: { select: { id: true } },
      refunds: { select: { id: true } },
    },
  })

  const deleted: number[] = []
  const skipped: { id: number; reason: string }[] = []

  for (const t of targets) {
    if (!t.bankRef) { skipped.push({ id: t.id, reason: 'no bankRef' }); continue }
    if (t.allocations.length > 0) { skipped.push({ id: t.id, reason: `has ${t.allocations.length} allocation(s)` }); continue }
    if (t.refunds.length > 0) { skipped.push({ id: t.id, reason: `has ${t.refunds.length} refund(s)` }); continue }

    const siblings = await db.ksiHdfcReceipt.count({
      where: { bankRef: t.bankRef, id: { not: t.id, notIn: deleted } },
    })
    if (siblings === 0) {
      skipped.push({ id: t.id, reason: 'no surviving sibling with same bankRef' })
      continue
    }

    await db.ksiHdfcReceipt.delete({ where: { id: t.id } })
    deleted.push(t.id)
  }

  // Anything in `ids` not in `targets` (e.g. someone else deleted it
  // already) reports as gone.
  const foundIds = new Set(targets.map((t: any) => t.id))
  for (const id of ids) {
    if (!foundIds.has(id)) skipped.push({ id, reason: 'row not found' })
  }

  return NextResponse.json({ deleted: deleted.length, deletedIds: deleted, skipped })
}
