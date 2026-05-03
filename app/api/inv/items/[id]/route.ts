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
  if (body.displayName) data.displayName = String(body.displayName).trim()
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

  // Alias re-mapping: blocked if item already used in a pushed invoice.
  if (body.aliasId && Number(body.aliasId) !== item.aliasId) {
    const used = await db.invPurchaseInvoiceLine.findFirst({
      where: {
        itemId: id,
        invoice: { status: 'PushedToTally' },
      },
      select: { id: true },
    })
    if (used) return NextResponse.json({ error: 'Cannot re-map alias: item used in a pushed invoice' }, { status: 409 })
    const newAlias = await db.invTallyAlias.findUnique({ where: { id: Number(body.aliasId) } })
    if (!newAlias) return NextResponse.json({ error: 'Alias not found' }, { status: 404 })
    data.aliasId = newAlias.id
    data.unit = newAlias.unit
    data.gstOverride = null
  }

  const updated = await db.invItem.update({
    where: { id },
    data,
    include: { alias: true, group: true },
  })
  return NextResponse.json(updated)
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
