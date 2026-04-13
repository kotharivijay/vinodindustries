import { NextRequest, NextResponse } from 'next/server'
import { prisma, viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const firm = req.nextUrl.searchParams.get('firm') || ''
  const search = req.nextUrl.searchParams.get('search') || ''
  const parent = req.nextUrl.searchParams.get('parent') || ''
  const sortParam = req.nextUrl.searchParams.get('sort') || 'name-asc'
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1') || 1
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50') || 50, 200)

  const db = (firm === 'KSI' ? prisma : viPrisma) as any
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

    let orderBy: any = { name: 'asc' }
    if (sortParam === 'name-desc') orderBy = { name: 'desc' }
    if (sortParam === 'parent-asc') orderBy = [{ parent: 'asc' }, { name: 'asc' }]

    const [ledgers, total] = await Promise.all([
      db.tallyLedger.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.tallyLedger.count({ where }),
    ])

    // Get unique parent groups (only on first page to save queries)
    let parentGroups: string[] = []
    if (page === 1) {
      const parents = await db.tallyLedger.findMany({
        where: firm ? { firmCode: firm } : {},
        select: { parent: true },
        distinct: ['parent'],
        orderBy: { parent: 'asc' },
      })
      parentGroups = parents.map((p: any) => p.parent).filter(Boolean)
    }

    return NextResponse.json({ ledgers, parentGroups, total })
  } catch {
    return NextResponse.json({ ledgers: [], parentGroups: [], total: 0 })
  }
}
