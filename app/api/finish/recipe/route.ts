import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

const recipeInclude = {
  party: { select: { id: true, name: true } },
  quality: { select: { id: true, name: true } },
  items: { include: { chemical: { select: { id: true, name: true, currentPrice: true } } } },
  tags: {
    include: {
      quality: { select: { id: true, name: true } },
      party: { select: { id: true, name: true } },
    },
  },
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const partyId = url.searchParams.get('partyId')
  const qualityId = url.searchParams.get('qualityId')
  const action = url.searchParams.get('action')

  // Get qualities for a party (from grey entries + OB)
  if (action === 'party-qualities' && partyId) {
    const pId = parseInt(partyId)
    const party = await prisma.party.findUnique({ where: { id: pId }, select: { name: true } })
    if (!party) return NextResponse.json([])

    // From grey entries
    const greyQualities = await prisma.greyEntry.findMany({
      where: { partyId: pId },
      select: { quality: { select: { id: true, name: true } } },
      distinct: ['qualityId'],
    })
    const qualityMap = new Map(greyQualities.map(g => [g.quality.id, g.quality]))

    // From OB (carry-forward lots)
    try {
      const obQualities = await db.lotOpeningBalance.findMany({
        where: { party: { equals: party.name, mode: 'insensitive' } },
        select: { quality: true },
        distinct: ['quality'],
      })
      for (const ob of obQualities) {
        if (ob.quality) {
          const q = await prisma.quality.findFirst({ where: { name: { equals: ob.quality, mode: 'insensitive' } } })
          if (q && !qualityMap.has(q.id)) qualityMap.set(q.id, q)
        }
      }
    } catch {}

    return NextResponse.json(Array.from(qualityMap.values()).sort((a, b) => a.name.localeCompare(b.name)))
  }

  // Single recipe lookup
  if (partyId && qualityId) {
    const pId = parseInt(partyId)
    const qId = parseInt(qualityId)

    // 1. Try exact match
    const recipe = await db.finishRecipe.findUnique({
      where: { partyId_qualityId: { partyId: pId, qualityId: qId } },
      include: recipeInclude,
    })
    if (recipe) {
      return NextResponse.json({ ...recipe, isTagged: false })
    }

    // 2. Try tag fallback
    const tag = await db.finishRecipeTag.findUnique({
      where: { partyId_qualityId: { partyId: pId, qualityId: qId } },
      include: {
        recipe: { include: recipeInclude },
      },
    })
    if (tag) {
      return NextResponse.json({
        ...tag.recipe,
        isTagged: true,
        taggedFrom: tag.recipe.quality.name,
      })
    }

    return NextResponse.json(null)
  }

  // Recipes for a party
  if (partyId) {
    const recipes = await db.finishRecipe.findMany({
      where: { partyId: parseInt(partyId) },
      include: recipeInclude,
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json(recipes)
  }

  // All recipes
  const recipes = await db.finishRecipe.findMany({
    include: recipeInclude,
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(recipes)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Tag action
  if (body.action === 'tag') {
    const { partyId, qualityId, recipeId } = body
    if (!partyId || !qualityId || !recipeId) {
      return NextResponse.json({ error: 'partyId, qualityId, and recipeId are required' }, { status: 400 })
    }
    try {
      const tag = await db.finishRecipeTag.create({
        data: {
          partyId: parseInt(partyId),
          qualityId: parseInt(qualityId),
          recipeId: parseInt(recipeId),
        },
        include: {
          quality: { select: { id: true, name: true } },
          party: { select: { id: true, name: true } },
          recipe: {
            include: recipeInclude,
          },
        },
      })
      return NextResponse.json(tag)
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return NextResponse.json({ error: 'Tag already exists for this party+quality' }, { status: 409 })
      }
      throw err
    }
  }

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
      include: recipeInclude,
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
    include: recipeInclude,
  })
  return NextResponse.json(created)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const tagId = url.searchParams.get('tagId')

  // Delete tag
  if (tagId) {
    await db.finishRecipeTag.delete({ where: { id: parseInt(tagId) } })
    return NextResponse.json({ success: true })
  }

  // Delete recipe
  if (!id) return NextResponse.json({ error: 'id or tagId is required' }, { status: 400 })
  await db.finishRecipe.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ success: true })
}
