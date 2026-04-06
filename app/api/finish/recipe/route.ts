import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const partyId = url.searchParams.get('partyId')
  const qualityId = url.searchParams.get('qualityId')

  // Single recipe lookup
  if (partyId && qualityId) {
    const recipe = await db.finishRecipe.findUnique({
      where: { partyId_qualityId: { partyId: parseInt(partyId), qualityId: parseInt(qualityId) } },
      include: {
        party: { select: { id: true, name: true } },
        quality: { select: { id: true, name: true } },
        items: { include: { chemical: { select: { id: true, name: true, currentPrice: true } } } },
      },
    })
    return NextResponse.json(recipe)
  }

  // Recipes for a party
  if (partyId) {
    const recipes = await db.finishRecipe.findMany({
      where: { partyId: parseInt(partyId) },
      include: {
        party: { select: { id: true, name: true } },
        quality: { select: { id: true, name: true } },
        items: { include: { chemical: { select: { id: true, name: true, currentPrice: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json(recipes)
  }

  // All recipes
  const recipes = await db.finishRecipe.findMany({
    include: {
      party: { select: { id: true, name: true } },
      quality: { select: { id: true, name: true } },
      items: { include: { chemical: { select: { id: true, name: true, currentPrice: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(recipes)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { partyId, qualityId, finishWidth, finalWidth, shortage, notes, items } = body

  if (!partyId || !qualityId) {
    return NextResponse.json({ error: 'partyId and qualityId are required' }, { status: 400 })
  }

  // Upsert recipe
  const existing = await db.finishRecipe.findUnique({
    where: { partyId_qualityId: { partyId: parseInt(partyId), qualityId: parseInt(qualityId) } },
  })

  if (existing) {
    // Delete old items and recreate
    await db.finishRecipeItem.deleteMany({ where: { recipeId: existing.id } })
    const updated = await db.finishRecipe.update({
      where: { id: existing.id },
      data: {
        finishWidth: finishWidth || null,
        finalWidth: finalWidth || null,
        shortage: shortage || null,
        notes: notes || null,
        items: {
          create: (items || []).map((item: any) => ({
            chemicalId: item.chemicalId || null,
            name: item.name,
            quantity: parseFloat(item.quantity) || 0,
            unit: item.unit || 'kg',
          })),
        },
      },
      include: {
        party: { select: { id: true, name: true } },
        quality: { select: { id: true, name: true } },
        items: { include: { chemical: { select: { id: true, name: true, currentPrice: true } } } },
      },
    })
    return NextResponse.json(updated)
  }

  const created = await db.finishRecipe.create({
    data: {
      partyId: parseInt(partyId),
      qualityId: parseInt(qualityId),
      finishWidth: finishWidth || null,
      finalWidth: finalWidth || null,
      shortage: shortage || null,
      notes: notes || null,
      items: {
        create: (items || []).map((item: any) => ({
          chemicalId: item.chemicalId || null,
          name: item.name,
          quantity: parseFloat(item.quantity) || 0,
          unit: item.unit || 'kg',
        })),
      },
    },
    include: {
      party: { select: { id: true, name: true } },
      quality: { select: { id: true, name: true } },
      items: { include: { chemical: { select: { id: true, name: true, currentPrice: true } } } },
    },
  })
  return NextResponse.json(created)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  await db.finishRecipe.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ success: true })
}
