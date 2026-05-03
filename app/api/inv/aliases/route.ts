export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase()
  const where: any = { active: true }
  if (q) where.OR = [
    { tallyStockItem: { contains: q, mode: 'insensitive' } },
    { displayName: { contains: q, mode: 'insensitive' } },
  ]

  const aliases = await db.invTallyAlias.findMany({ where, orderBy: { tallyStockItem: 'asc' }, take: 5000 })
  return NextResponse.json(aliases)
}

export async function PATCH(req: NextRequest) {
  // Edit local-only fields on an alias (godownOverride, defaultTrackStock).
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, godownOverride, defaultTrackStock, category } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const data: any = {}
  if (godownOverride !== undefined) data.godownOverride = godownOverride || null
  if (defaultTrackStock !== undefined) data.defaultTrackStock = !!defaultTrackStock
  if (category && ['Chemical', 'Dye', 'Auxiliary', 'Spare'].includes(category)) data.category = category

  const updated = await db.invTallyAlias.update({ where: { id: Number(id) }, data })
  return NextResponse.json(updated)
}
