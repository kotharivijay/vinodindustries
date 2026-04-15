export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET — fetch single chemical with price history
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const chemical = await db.chemical.findUnique({
    where: { id: parseInt(id) },
    include: { priceHistory: { orderBy: { date: 'desc' }, take: 20 } },
  })
  if (!chemical) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(chemical)
}

// PATCH — update price, unit, name, and/or category
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const data = await req.json()

  const updateData: Record<string, unknown> = {}
  if (data.name != null) updateData.name = data.name.trim()
  if (data.unit != null) updateData.unit = data.unit.trim()
  if (data.price != null) updateData.currentPrice = parseFloat(data.price)
  if (data.category !== undefined) updateData.category = data.category  // allow null to clear

  const chemical = await db.chemical.update({
    where: { id: parseInt(id) },
    data: updateData,
  })

  // Record price history if price changed
  if (data.price != null) {
    await db.chemicalPriceHistory.create({
      data: {
        chemicalId: chemical.id,
        price: parseFloat(data.price),
        source: data.source ?? 'manual',
        note: data.note ?? null,
      },
    })
  }

  const result = await db.chemical.findUnique({
    where: { id: chemical.id },
    include: { priceHistory: { orderBy: { date: 'desc' }, take: 10 } },
  })

  return NextResponse.json(result)
}

// PUT — full update (name, unit, price, category)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const data = await req.json()

  const updateData: Record<string, unknown> = {}
  if (data.name != null) updateData.name = data.name.trim()
  if (data.unit != null) updateData.unit = data.unit.trim()
  if (data.price != null) updateData.currentPrice = parseFloat(data.price)
  if (data.category !== undefined) updateData.category = data.category

  const chemical = await db.chemical.update({
    where: { id: parseInt(id) },
    data: updateData,
  })

  if (data.price != null) {
    await db.chemicalPriceHistory.create({
      data: {
        chemicalId: chemical.id,
        price: parseFloat(data.price),
        source: 'manual',
        note: data.note ?? null,
      },
    })
  }

  const result = await db.chemical.findUnique({
    where: { id: chemical.id },
    include: { priceHistory: { orderBy: { date: 'desc' }, take: 10 } },
  })

  return NextResponse.json(result)
}

// DELETE — remove chemical
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await db.chemical.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
