export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Merge a duplicate item into a canonical one.
 * Body: { targetId }
 *
 * Effects (single transaction):
 *  - All InvChallanLine / InvPurchaseInvoiceLine / InvPOLine /
 *    InvStockMovement rows pointing at the source repoint to target.
 *  - InvPurchaseInvoiceLine.description rows that snapshot-stored the
 *    source's displayName get rewritten to the target's displayName.
 *    Manual overrides (anything ≠ source.displayName) are preserved.
 *  - Source item is soft-deleted (active=false) so it can't be picked
 *    again from the catalog, but the row stays for audit.
 *
 * Blocked with 409 if the source is referenced from any invoice already
 * pushed to Tally — that voucher's stockitemname is the source's alias
 * name, and re-pointing the local item would orphan the Tally record.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sourceId = Number(params.id)
  const body = await req.json().catch(() => ({}))
  const targetId = Number(body?.targetId)

  if (!targetId || sourceId === targetId) {
    return NextResponse.json({ error: 'targetId required and must differ from source' }, { status: 400 })
  }

  const [source, target] = await Promise.all([
    db.invItem.findUnique({ where: { id: sourceId }, include: { alias: true } }),
    db.invItem.findUnique({ where: { id: targetId }, include: { alias: true } }),
  ])
  if (!source) return NextResponse.json({ error: 'Source item not found' }, { status: 404 })
  if (!target) return NextResponse.json({ error: 'Target item not found' }, { status: 404 })
  if (!target.active) return NextResponse.json({ error: 'Target item is inactive' }, { status: 409 })

  // Don't allow merging across different aliases (different Tally stock
  // items / GST rates) — the operator likely fat-fingered the alias too,
  // and silently re-categorising on merge is dangerous.
  if (source.aliasId !== target.aliasId) {
    return NextResponse.json({
      error: `Source aliased to "${source.alias.tallyStockItem}" but target is "${target.alias.tallyStockItem}". Aliases must match before merge.`,
    }, { status: 409 })
  }

  // Block if any reference is on a pushed invoice
  const pushedRef = await db.invPurchaseInvoiceLine.findFirst({
    where: { itemId: sourceId, invoice: { status: 'PushedToTally' } },
    select: { id: true, invoice: { select: { id: true, supplierInvoiceNo: true } } },
  })
  if (pushedRef) {
    return NextResponse.json({
      error: `Cannot merge — used in pushed invoice ${pushedRef.invoice.supplierInvoiceNo}. Void/cancel first.`,
    }, { status: 409 })
  }

  let counts: any = {}
  await db.$transaction(async (tx: any) => {
    const [c1, c2, c3, c4, c5] = await Promise.all([
      tx.invChallanLine.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } }),
      tx.invPurchaseInvoiceLine.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } }),
      tx.invPOLine.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } }),
      tx.invStockMovement.updateMany({ where: { itemId: sourceId }, data: { itemId: targetId } }),
      tx.invPurchaseInvoiceLine.updateMany({
        where: { itemId: targetId, description: source.displayName },
        data: { description: target.displayName },
      }),
    ])
    counts = {
      challanLines: c1.count, invoiceLines: c2.count, poLines: c3.count,
      stockMovements: c4.count, descriptionsRewritten: c5.count,
    }
    await tx.invItem.update({
      where: { id: sourceId },
      data: { active: false, reviewStatus: 'rejected', rejectionReason: `Merged into item id=${targetId} (${target.displayName})` },
    })
  })

  return NextResponse.json({
    ok: true,
    merged: { from: { id: sourceId, displayName: source.displayName }, into: { id: targetId, displayName: target.displayName } },
    counts,
  })
}
