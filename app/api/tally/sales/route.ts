export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const firm = req.nextUrl.searchParams.get('firm') || ''
  const search = req.nextUrl.searchParams.get('search') || ''
  const dateFrom = req.nextUrl.searchParams.get('dateFrom') || ''
  const dateTo = req.nextUrl.searchParams.get('dateTo') || ''
  const party = req.nextUrl.searchParams.get('party') || ''
  const sortParam = req.nextUrl.searchParams.get('sort') || 'date-desc'
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1') || 1
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50') || 50, 200)

  const db = viPrisma as any
  try {
    const where: any = {}
    if (firm) where.firmCode = firm
    if (party) where.partyName = { contains: party, mode: 'insensitive' }
    if (search) {
      where.OR = [
        { partyName: { contains: search, mode: 'insensitive' } },
        { itemName: { contains: search, mode: 'insensitive' } },
        { vchNumber: { contains: search, mode: 'insensitive' } },
        { narration: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) where.date.lte = new Date(dateTo + 'T23:59:59.999Z')
    }

    let orderBy: any = { date: 'desc' }
    if (sortParam === 'date-asc') orderBy = { date: 'asc' }
    else if (sortParam === 'amount-desc') orderBy = { amount: 'desc' }
    else if (sortParam === 'party-asc') orderBy = { partyName: 'asc' }

    const [sales, total] = await Promise.all([
      db.tallySales.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.tallySales.count({ where }),
    ])

    // Calculate total sales amount
    const sumResult = await db.tallySales.aggregate({
      where: firm ? { firmCode: firm } : {},
      _sum: { amount: true },
    })
    const totalAmount = sumResult._sum.amount || 0

    const resp = NextResponse.json({ sales, total, totalAmount })
    resp.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return resp
  } catch {
    return NextResponse.json({ sales: [], total: 0, totalAmount: 0 })
  }
}
