export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { reason } = await req.json().catch(() => ({}))
  const updated = await db.invItem.update({
    where: { id: Number(params.id) },
    data: { reviewStatus: 'rejected', reviewedAt: new Date(), rejectionReason: reason || null },
  })
  return NextResponse.json(updated)
}
