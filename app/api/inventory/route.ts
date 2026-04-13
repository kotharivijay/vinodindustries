import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

const DEFAULT_CATEGORIES = [
  'Dyes & Auxiliary',
  'Packing Material',
  'Machinery Parts',
  'Fuel',
  'Interlock Service',
  'Motor Service',
  'Others',
]

async function ensureCategories() {
  for (const name of DEFAULT_CATEGORIES) {
    await db.inventoryCategory.upsert({
      where: { name },
      create: { name },
      update: {},
    })
  }
}

// GET — list items for a category, with calculated stock
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureCategories()

  const categoryName = req.nextUrl.searchParams.get('category') || 'Dyes & Auxiliary'

  const category = await db.inventoryCategory.findUnique({
    where: { name: categoryName },
    include: {
      items: {
        where: { isActive: true },
        include: {
          transactions: { orderBy: { date: 'desc' } },
          physicalStock: { orderBy: { date: 'desc' }, take: 1 },
        },
        orderBy: { name: 'asc' },
      },
    },
  })

  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const items = category.items.map((item: any) => {
    const purchased = item.transactions
      .filter((t: any) => t.type === 'purchase')
      .reduce((s: number, t: any) => s + t.quantity, 0)
    const consumed = item.transactions
      .filter((t: any) => t.type === 'consumed')
      .reduce((s: number, t: any) => s + t.quantity, 0)
    const adjustments = item.transactions
      .filter((t: any) => t.type === 'adjustment')
      .reduce((s: number, t: any) => s + t.quantity, 0)
    const returned = item.transactions
      .filter((t: any) => t.type === 'return')
      .reduce((s: number, t: any) => s + t.quantity, 0)

    const openingStock = item.transactions
      .filter((t: any) => t.type === 'opening')
      .reduce((s: number, t: any) => s + t.quantity, 0)

    const calculatedStock = openingStock + purchased - consumed + adjustments + returned
    const lastPhysical = item.physicalStock[0] || null
    const totalPurchaseAmount = item.transactions
      .filter((t: any) => t.type === 'purchase')
      .reduce((s: number, t: any) => s + (t.amount || 0), 0)

    return {
      id: item.id,
      name: item.name,
      unit: item.unit,
      chemicalId: item.chemicalId,
      minStock: item.minStock,
      openingStock: Math.round(openingStock * 1000) / 1000,
      purchased: Math.round(purchased * 1000) / 1000,
      consumed: Math.round(consumed * 1000) / 1000,
      adjustments: Math.round(adjustments * 1000) / 1000,
      calculatedStock: Math.round(calculatedStock * 1000) / 1000,
      physicalStock: lastPhysical ? Math.round(lastPhysical.quantity * 1000) / 1000 : null,
      physicalDate: lastPhysical?.date || null,
      variance: lastPhysical ? Math.round((calculatedStock - lastPhysical.quantity) * 1000) / 1000 : null,
      totalPurchaseAmount: Math.round(totalPurchaseAmount),
      isLowStock: item.minStock != null && calculatedStock <= item.minStock,
      recentTransactions: item.transactions.slice(0, 5).map((t: any) => ({
        id: t.id, type: t.type, quantity: t.quantity, rate: t.rate, amount: t.amount, date: t.date, reference: t.reference, notes: t.notes,
      })),
    }
  })

  const categories = await db.inventoryCategory.findMany({ orderBy: { name: 'asc' } })

  return NextResponse.json({ category: category.name, categoryId: category.id, items, categories })
}

// POST — add item or transaction
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Add new item
  if (body.action === 'add-item') {
    const { categoryId, name, unit, chemicalId, minStock } = body
    if (!categoryId || !name) return NextResponse.json({ error: 'categoryId and name required' }, { status: 400 })

    const item = await db.inventoryItem.create({
      data: {
        categoryId: parseInt(categoryId),
        name: name.trim(),
        unit: unit || 'kg',
        chemicalId: chemicalId ? parseInt(chemicalId) : null,
        minStock: minStock ? parseFloat(minStock) : null,
      },
    })
    return NextResponse.json(item, { status: 201 })
  }

  // Add transaction (purchase, opening, adjustment)
  if (body.action === 'add-transaction') {
    const { itemId, type, quantity, rate, date, reference, notes } = body
    if (!itemId || !type || quantity == null) return NextResponse.json({ error: 'itemId, type, quantity required' }, { status: 400 })

    const qty = parseFloat(quantity)
    const r = rate ? parseFloat(rate) : null
    const amount = r ? qty * r : null

    const txn = await db.inventoryTransaction.create({
      data: {
        itemId: parseInt(itemId),
        type,
        quantity: qty,
        rate: r,
        amount,
        date: date ? new Date(date) : new Date(),
        reference: reference || null,
        notes: notes || null,
      },
    })
    return NextResponse.json(txn, { status: 201 })
  }

  // Record physical stock
  if (body.action === 'physical-stock') {
    const { itemId, quantity, date, notes } = body
    if (!itemId || quantity == null) return NextResponse.json({ error: 'itemId and quantity required' }, { status: 400 })

    const entry = await db.physicalStockEntry.create({
      data: {
        itemId: parseInt(itemId),
        quantity: parseFloat(quantity),
        date: date ? new Date(date) : new Date(),
        notes: notes || null,
      },
    })
    return NextResponse.json(entry, { status: 201 })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

// DELETE — remove item or transaction
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, id } = await req.json()

  if (action === 'delete-item') {
    await db.inventoryItem.update({ where: { id: parseInt(id) }, data: { isActive: false } })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete-transaction') {
    await db.inventoryTransaction.delete({ where: { id: parseInt(id) } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
