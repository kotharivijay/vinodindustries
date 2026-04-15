export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET — list deliveries
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const deliveries = await db.deliveryChallan.findMany({
    include: { items: { include: { item: true } }, po: { select: { poNo: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(deliveries)
}

// POST — create delivery challan + auto-add to inventory
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { challanNo, date, partyName, poId, notes, items, category } = await req.json()
  if (!challanNo || !partyName || !items?.length) return NextResponse.json({ error: 'challanNo, partyName, items required' }, { status: 400 })

  const challan = await db.deliveryChallan.create({
    data: {
      challanNo,
      date: date ? new Date(date) : new Date(),
      partyName,
      poId: poId ? parseInt(poId) : null,
      notes: notes || null,
      items: {
        create: items.map((i: any) => ({
          itemId: parseInt(i.itemId),
          itemDescription: i.itemDescription || null,
          quantity: parseFloat(i.quantity) || 0,
          rate: i.rate ? parseFloat(i.rate) : null,
          amount: i.rate && i.quantity ? parseFloat(i.quantity) * parseFloat(i.rate) : null,
        })),
      },
    },
    include: { items: { include: { item: true } } },
  })

  // Auto-add purchase transactions to inventory
  for (const i of items) {
    if (!i.itemId || !i.quantity) continue
    const qty = parseFloat(i.quantity) || 0
    const rate = i.rate ? parseFloat(i.rate) : null
    await db.inventoryTransaction.create({
      data: {
        itemId: parseInt(i.itemId),
        type: 'purchase',
        quantity: qty,
        rate,
        amount: rate ? qty * rate : null,
        date: date ? new Date(date) : new Date(),
        reference: `DC-${challanNo}`,
        notes: `Delivery from ${partyName}`,
      },
    })
  }

  // Auto-learn aliases
  for (const i of items) {
    if (!i.itemDescription?.trim() || !i.itemId) continue
    try {
      await db.inventoryItemAlias.upsert({
        where: { alias_partyName: { alias: i.itemDescription.trim(), partyName } },
        create: { itemId: parseInt(i.itemId), partyName, alias: i.itemDescription.trim() },
        update: { usedAt: new Date() },
      })
    } catch {}
  }

  // Update PO status if linked
  if (poId) {
    try {
      await db.purchaseOrder.update({ where: { id: parseInt(poId) }, data: { status: 'delivered' } })
    } catch {}
  }

  return NextResponse.json(challan, { status: 201 })
}
