import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// PATCH — update price (and optionally unit/name)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const data = await req.json()

  const updateData: Record<string, unknown> = {}
  if (data.name != null) updateData.name = data.name.trim()
  if (data.unit != null) updateData.unit = data.unit.trim()
  if (data.price != null) updateData.currentPrice = parseFloat(data.price)

  const chemical = await prisma.chemical.update({
    where: { id: parseInt(id) },
    data: updateData,
  })

  // Record price history if price changed
  if (data.price != null) {
    await prisma.chemicalPriceHistory.create({
      data: {
        chemicalId: chemical.id,
        price: parseFloat(data.price),
        source: data.source ?? 'manual',
        note: data.note ?? null,
      },
    })
  }

  const result = await prisma.chemical.findUnique({
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
  await prisma.chemical.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
