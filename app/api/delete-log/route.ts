export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const moduleParam = req.nextUrl.searchParams.get('module')
  const q = req.nextUrl.searchParams.get('q')
  const take = Math.min(parseInt(req.nextUrl.searchParams.get('take') || '200', 10), 1000)

  const where: any = {}
  if (moduleParam) where.module = moduleParam
  if (q) {
    where.OR = [
      { lotNo: { contains: q, mode: 'insensitive' } },
      { slipNo: { contains: q, mode: 'insensitive' } },
      { userEmail: { contains: q, mode: 'insensitive' } },
    ]
  }

  const logs = await db.deleteLog.findMany({
    where,
    orderBy: { deletedAt: 'desc' },
    take,
  })
  return NextResponse.json(logs)
}
