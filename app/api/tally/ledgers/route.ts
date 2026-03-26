import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const firm = req.nextUrl.searchParams.get('firm') || ''
  const search = req.nextUrl.searchParams.get('search') || ''
  const parent = req.nextUrl.searchParams.get('parent') || ''

  const db = prisma as any
  try {
    const where: any = {}
    if (firm) where.firmCode = firm
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { gstNo: { contains: search, mode: 'insensitive' } },
        { panNo: { contains: search, mode: 'insensitive' } },
        { mobileNos: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (parent) where.parent = { contains: parent, mode: 'insensitive' }

    const ledgers = await db.tallyLedger.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 500,
    })

    // Get unique parent groups for filter
    const parents = await db.tallyLedger.findMany({
      where: firm ? { firmCode: firm } : {},
      select: { parent: true },
      distinct: ['parent'],
      orderBy: { parent: 'asc' },
    })

    return NextResponse.json({
      ledgers,
      parentGroups: parents.map((p: any) => p.parent).filter(Boolean),
      total: await db.tallyLedger.count({ where }),
    })
  } catch {
    return NextResponse.json({ ledgers: [], parentGroups: [], total: 0 })
  }
}
