import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// PUT /api/shades/[id] — update name, description, and full recipe
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const { name, description, recipeItems } = await req.json() as {
    name: string
    description?: string
    recipeItems: { chemicalId: number; quantity: number }[]
  }

  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  try {
    const shade = await (prisma as any).$transaction(async (tx: any) => {
      // Update shade fields
      await tx.shade.update({
        where: { id },
        data: { name: name.trim(), description: description?.trim() || null },
      })

      // Replace all recipe items
      await tx.shadeRecipeItem.deleteMany({ where: { shadeId: id } })

      if (recipeItems?.length > 0) {
        await tx.shadeRecipeItem.createMany({
          data: recipeItems
            .filter(r => r.chemicalId && r.quantity > 0)
            .map(r => ({ shadeId: id, chemicalId: r.chemicalId, quantity: r.quantity })),
        })
      }

      return tx.shade.findUnique({
        where: { id },
        include: {
          recipeItems: {
            include: { chemical: { select: { id: true, name: true, unit: true } } },
            orderBy: { id: 'asc' },
          },
        },
      })
    })

    return NextResponse.json(shade)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Shade name already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
