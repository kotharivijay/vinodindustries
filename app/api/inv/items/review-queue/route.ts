export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = await db.invItem.findMany({
    where: { reviewStatus: 'pending_review', active: true },
    include: { alias: true, group: true, challanLines: { take: 1, orderBy: { id: 'desc' }, select: { challan: { select: { challanNo: true, party: { select: { displayName: true } } } } } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(items)
}
