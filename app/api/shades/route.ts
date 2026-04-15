export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const recipeInclude = {
  recipeItems: {
    include: { chemical: { select: { id: true, name: true, unit: true } } },
    orderBy: { id: 'asc' as const },
  },
}

// GET /api/shades — list all shades with recipe items
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const shades = await (prisma as any).shade.findMany({
    orderBy: { name: 'asc' },
    include: recipeInclude,
  })
  return NextResponse.json(shades)
}

// POST /api/shades — create shade (optionally with recipeItems)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, description, recipeItems } = await req.json() as {
    name: string
    description?: string
    recipeItems?: { chemicalId: number; quantity: number }[]
  }
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const cleanItems = (recipeItems ?? []).filter(r => r.chemicalId && r.quantity > 0)

  try {
    const shade = await (prisma as any).$transaction(async (tx: any) => {
      // Upsert shade by name
      let s = await tx.shade.findUnique({ where: { name: name.trim() } })
      if (s) {
        // Update description and replace recipe items
        await tx.shade.update({ where: { id: s.id }, data: { description: description?.trim() || null } })
        await tx.shadeRecipeItem.deleteMany({ where: { shadeId: s.id } })
      } else {
        s = await tx.shade.create({
          data: { name: name.trim(), description: description?.trim() || null },
        })
      }
      if (cleanItems.length) {
        await tx.shadeRecipeItem.createMany({
          data: cleanItems.map(r => ({ shadeId: s.id, chemicalId: r.chemicalId, quantity: r.quantity })),
        })
      }
      return tx.shade.findUnique({ where: { id: s.id }, include: recipeInclude })
    })
    return NextResponse.json(shade)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/shades?id=123
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(req.nextUrl.searchParams.get('id') ?? '')
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  await (prisma as any).shade.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
