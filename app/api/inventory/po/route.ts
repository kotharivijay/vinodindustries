export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET — list POs or single PO
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const action = req.nextUrl.searchParams.get('action')
  const poId = req.nextUrl.searchParams.get('id')

  // Return Tally ledger names for party selection
  if (action === 'ledgers') {
    const tagFilter = req.nextUrl.searchParams.get('tag')
    const where: any = { firmCode: 'KSI' }
    if (tagFilter) where.tags = { has: tagFilter }
    const ledgers = await db.tallyLedger.findMany({
      where,
      select: { name: true, parent: true, mobileNos: true, tags: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(ledgers)
  }

  if (poId) {
    const po = await db.purchaseOrder.findUnique({
      where: { id: parseInt(poId) },
      include: { items: { include: { item: true } }, deliveries: { include: { items: true } } },
    })
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(po)
  }

  const pos = await db.purchaseOrder.findMany({
    include: { items: { include: { item: true } }, _count: { select: { deliveries: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(pos)
}

// POST — create PO
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { partyName, partyMobile, items, notes } = body

  if (!partyName || !items?.length) return NextResponse.json({ error: 'Party and items required' }, { status: 400 })

  // Generate PO number
  const lastPo = await db.purchaseOrder.findFirst({ orderBy: { createdAt: 'desc' }, select: { poNo: true } })
  const lastNum = lastPo ? parseInt(lastPo.poNo.replace(/\D/g, '')) || 0 : 0
  const poNo = `PO-${String(lastNum + 1).padStart(3, '0')}`

  const po = await db.purchaseOrder.create({
    data: {
      poNo,
      date: new Date(),
      partyName,
      partyMobile: partyMobile || null,
      notes: notes || null,
      items: {
        create: items.map((i: any) => ({
          itemId: parseInt(i.itemId),
          quantity: parseFloat(i.quantity) || 0,
          rate: i.rate ? parseFloat(i.rate) : null,
          notes: i.notes || null,
        })),
      },
    },
    include: { items: { include: { item: true } } },
  })

  // Update alias: use party alias for WhatsApp (most recent)
  for (const i of items) {
    if (i.aliasName?.trim()) {
      await db.inventoryItemAlias.upsert({
        where: { alias_partyName: { alias: i.aliasName.trim(), partyName } },
        create: { itemId: parseInt(i.itemId), partyName, alias: i.aliasName.trim() },
        update: { usedAt: new Date() },
      })
    }
  }

  return NextResponse.json(po, { status: 201 })
}

// GET item purchase history
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, itemIds, partyName } = await req.json()

  if (action === 'history') {
    // Purchase history for selected items
    const txns = await db.inventoryTransaction.findMany({
      where: { itemId: { in: itemIds.map((id: any) => parseInt(id)) }, type: 'purchase' },
      include: { item: true },
      orderBy: { date: 'desc' },
      take: 50,
    })
    return NextResponse.json(txns)
  }

  if (action === 'aliases') {
    // Get aliases for items + party
    const aliases = await db.inventoryItemAlias.findMany({
      where: { itemId: { in: itemIds.map((id: any) => parseInt(id)) }, partyName: { equals: partyName, mode: 'insensitive' } },
      orderBy: { usedAt: 'desc' },
    })
    return NextResponse.json(aliases)
  }

  if (action === 'party-mobile') {
    // Get mobile from TallyLedger
    try {
      const ledger = await db.tallyLedger.findFirst({
        where: { name: { contains: partyName, mode: 'insensitive' } },
        select: { mobileNos: true },
      })
      return NextResponse.json({ mobile: ledger?.mobileNos || null })
    } catch {
      return NextResponse.json({ mobile: null })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
