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
  const reviewStatus = req.nextUrl.searchParams.get('reviewStatus') // 'pending_review' / 'rejected' / 'approved'
  const aliasIdRaw = req.nextUrl.searchParams.get('aliasId')

  const where: any = { active: true }
  if (q) where.displayName = { contains: q, mode: 'insensitive' }
  if (reviewStatus) where.reviewStatus = reviewStatus
  if (aliasIdRaw) {
    const aliasId = Number(aliasIdRaw)
    if (Number.isFinite(aliasId)) where.aliasId = aliasId
  }

  const items = await db.invItem.findMany({
    where,
    include: { alias: true, group: true },
    orderBy: { displayName: 'asc' },
    take: 500,
  })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { displayName, aliasId, groupId, hsnOverride, gstOverride, autoApprove } = body
  if (!displayName || !aliasId) {
    return NextResponse.json({ error: 'displayName + aliasId required' }, { status: 400 })
  }
  const alias = await db.invTallyAlias.findUnique({ where: { id: Number(aliasId) } })
  if (!alias) return NextResponse.json({ error: 'Alias not found' }, { status: 404 })

  if (gstOverride != null && Number(gstOverride) !== Number(alias.gstRate)) {
    return NextResponse.json({ error: 'gstOverride must equal alias.gstRate' }, { status: 400 })
  }

  // Operator-created → pending_review; manager can pass autoApprove flag
  const reviewStatus = autoApprove ? 'approved' : 'pending_review'

  try {
    const created = await db.invItem.create({
      data: {
        displayName: String(displayName).trim(),
        aliasId: alias.id,
        groupId: groupId ? Number(groupId) : null,
        unit: alias.unit,
        hsnOverride: hsnOverride || null,
        gstOverride: gstOverride != null ? Number(gstOverride) : null,
        trackStock: alias.defaultTrackStock,
        reviewStatus,
      },
      include: { alias: true, group: true },
    })
    return NextResponse.json(created)
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'displayName already exists' }, { status: 409 })
    }
    throw e
  }
}
