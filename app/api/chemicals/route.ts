import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET — list all chemicals with latest price history
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chemicals = await prisma.chemical.findMany({
    include: {
      priceHistory: { orderBy: { date: 'desc' }, take: 5 },
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(chemicals)
}

// POST — create single or bulk import
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  // Bulk import: { rows: [{ name, unit, price }] }
  if (data.rows) {
    const results: { name: string; status: 'created' | 'updated' | 'skipped'; id: number }[] = []

    for (const row of data.rows) {
      const name = row.name?.trim()
      if (!name) continue
      const unit = row.unit?.trim() || 'kg'
      const price = row.price != null ? parseFloat(row.price) : null

      const existing = await prisma.chemical.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      })

      if (existing) {
        // Update price if provided and different
        if (price != null && price !== existing.currentPrice) {
          await prisma.chemical.update({
            where: { id: existing.id },
            data: { currentPrice: price, unit },
          })
          await prisma.chemicalPriceHistory.create({
            data: { chemicalId: existing.id, price, source: 'manual', note: 'Bulk import update' },
          })
          results.push({ name, status: 'updated', id: existing.id })
        } else {
          results.push({ name, status: 'skipped', id: existing.id })
        }
      } else {
        const chemical = await prisma.chemical.create({
          data: { name, unit, currentPrice: price },
        })
        if (price != null) {
          await prisma.chemicalPriceHistory.create({
            data: { chemicalId: chemical.id, price, source: 'manual', note: 'Initial import' },
          })
        }
        results.push({ name, status: 'created', id: chemical.id })
      }
    }

    return NextResponse.json({ results })
  }

  // Single create: { name, unit, price }
  const name = data.name?.trim()
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const existing = await prisma.chemical.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  })
  if (existing) return NextResponse.json({ error: 'Chemical already exists' }, { status: 409 })

  const unit = data.unit?.trim() || 'kg'
  const price = data.price != null ? parseFloat(data.price) : null

  const chemical = await prisma.chemical.create({
    data: { name, unit, currentPrice: price },
    include: { priceHistory: true },
  })

  if (price != null) {
    await prisma.chemicalPriceHistory.create({
      data: { chemicalId: chemical.id, price, source: 'manual', note: 'Created' },
    })
  }

  const result = await prisma.chemical.findUnique({
    where: { id: chemical.id },
    include: { priceHistory: { orderBy: { date: 'desc' } } },
  })

  return NextResponse.json(result, { status: 201 })
}
