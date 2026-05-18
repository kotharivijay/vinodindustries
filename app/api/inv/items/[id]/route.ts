export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const item = await db.invItem.findUnique({
    where: { id: Number(params.id) },
    include: { alias: true, group: true },
  })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(item)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const id = Number(params.id)
  const item = await db.invItem.findUnique({ where: { id }, include: { alias: true } })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: any = {}
  const oldDisplayName = item.displayName
  let renaming = false
  if (body.displayName) {
    const trimmed = String(body.displayName).trim()
    if (trimmed !== oldDisplayName) {
      // Block rename to a name already in use — operator should use Merge instead.
      const conflict = await db.invItem.findUnique({ where: { displayName: trimmed }, select: { id: true } })
      if (conflict && conflict.id !== id) {
        return NextResponse.json({
          error: `Another item already uses the name "${trimmed}". Use Merge to combine them.`,
        }, { status: 409 })
      }
      data.displayName = trimmed
      renaming = true
    }
  }
  if (body.groupId !== undefined) data.groupId = body.groupId ? Number(body.groupId) : null
  if (body.hsnOverride !== undefined) data.hsnOverride = body.hsnOverride || null
  if (body.gstOverride !== undefined) {
    if (body.gstOverride != null && Number(body.gstOverride) !== Number(item.alias.gstRate)) {
      return NextResponse.json({ error: 'gstOverride must equal alias.gstRate' }, { status: 400 })
    }
    data.gstOverride = body.gstOverride != null ? Number(body.gstOverride) : null
  }
  if (body.trackStock !== undefined) data.trackStock = !!body.trackStock
  if (Array.isArray(body.usageTags)) {
    // Normalise: trim, drop empties, dedupe. Allowed-value enforcement is
    // intentionally left to the UI so floor changes don't need a migration.
    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const t of body.usageTags) {
      const v = String(t || '').trim()
      if (!v || seen.has(v)) continue
      seen.add(v); cleaned.push(v)
    }
    data.usageTags = cleaned
  }

  // Alias re-mapping: blocked if item is used in any non-voided invoice that
  // has already been pushed to Tally (would desync the on-disk voucher).
  // Returns a structured payload so the UI can list the offending invoices.
  let aliasRemap: { from: any; to: any } | null = null
  if (body.aliasId && Number(body.aliasId) !== item.aliasId) {
    const blockingLines = await db.invPurchaseInvoiceLine.findMany({
      where: {
        itemId: id,
        invoice: { status: 'PushedToTally' },
      },
      select: {
        invoice: {
          select: { id: true, supplierInvoiceNo: true, supplierInvoiceDate: true, tallyVoucherNo: true },
        },
      },
    })
    if (blockingLines.length) {
      const seen = new Set<number>()
      const usedInInvoices: any[] = []
      for (const l of blockingLines) {
        if (!l.invoice || seen.has(l.invoice.id)) continue
        seen.add(l.invoice.id)
        usedInInvoices.push(l.invoice)
      }
      return NextResponse.json({
        error: `Cannot re-map alias — item is on ${usedInInvoices.length} pushed invoice(s). Void or unlink those first.`,
        code: 'ALIAS_IN_USE',
        details: { usedInInvoices, usedInInvoiceCount: usedInInvoices.length },
      }, { status: 409 })
    }
    const newAlias = await db.invTallyAlias.findUnique({ where: { id: Number(body.aliasId) } })
    if (!newAlias) return NextResponse.json({ error: 'Alias not found', code: 'ALIAS_NOT_FOUND' }, { status: 404 })
    data.aliasId = newAlias.id
    data.unit = newAlias.unit
    data.gstOverride = null
    aliasRemap = { from: item.alias, to: newAlias }
  }

  const updated = await db.invItem.update({
    where: { id },
    data,
    include: { alias: true, group: true },
  })

  // Optional: refresh InvPurchaseInvoiceLine.description rows that were
  // snapshot-saved as the OLD displayName. Manually-overridden descriptions
  // (anything ≠ oldDisplayName) are preserved.
  // InvChallanLine has no description column — its display always comes from
  // the joined item.displayName, so renames flow through automatically.
  let descLinesUpdated = 0
  if (renaming && body.refreshLineDescriptions !== false) {
    const r = await db.invPurchaseInvoiceLine.updateMany({
      where: { itemId: id, description: oldDisplayName },
      data: { description: data.displayName },
    })
    descLinesUpdated = r.count ?? 0
  }

  // Audit alias remap (rename audit lives outside this block since it can be
  // chained with the remap in a single PATCH).
  if (aliasRemap) {
    await db.invAuditLog.create({
      data: {
        action: 'ITEM_ALIAS_REMAP',
        entityType: 'InvItem',
        entityId: id,
        payload: {
          itemDisplayName: updated.displayName,
          from: { aliasId: aliasRemap.from.id, tallyStockItem: aliasRemap.from.tallyStockItem, unit: aliasRemap.from.unit, gstRate: aliasRemap.from.gstRate },
          to: { aliasId: aliasRemap.to.id, tallyStockItem: aliasRemap.to.tallyStockItem, unit: aliasRemap.to.unit, gstRate: aliasRemap.to.gstRate },
          reason: body.remapReason || null,
        },
      },
    })
  }

  return NextResponse.json({ ...updated, _meta: { descLinesUpdated, aliasRemapped: !!aliasRemap } })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Soft-delete only; never hard-delete (referential integrity + audit trail).
  const updated = await db.invItem.update({
    where: { id: Number(params.id) },
    data: { active: false },
  })
  return NextResponse.json({ ok: true, id: updated.id })
}
