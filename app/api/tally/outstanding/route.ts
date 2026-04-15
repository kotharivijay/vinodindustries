export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const firm = req.nextUrl.searchParams.get('firm') || ''
  const type = req.nextUrl.searchParams.get('type') || ''
  const search = req.nextUrl.searchParams.get('search') || ''
  const parent = req.nextUrl.searchParams.get('parent') || ''
  const sortParam = req.nextUrl.searchParams.get('sort') || 'amount-desc'
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1') || 1
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50') || 50, 10000)

  const party = req.nextUrl.searchParams.get('party') || ''
  const agent = req.nextUrl.searchParams.get('agent') || ''

  const db = viPrisma as any
  try {
    const where: any = {}
    if (firm) where.firmCode = firm
    if (type && type !== 'bank') where.type = type
    if (party) where.partyName = { equals: party, mode: 'insensitive' }
    else if (search) where.partyName = { contains: search, mode: 'insensitive' }
    if (parent) where.parent = { contains: parent, mode: 'insensitive' }

    let orderBy: any = { closingBalance: 'desc' }
    if (sortParam === 'amount-asc') orderBy = { closingBalance: 'asc' }
    else if (sortParam === 'name-asc') orderBy = { partyName: 'asc' }
    else if (sortParam === 'overdue-desc') orderBy = { overdueDays: 'desc' }
    else if (sortParam === 'parent-asc') orderBy = [{ parent: 'asc' }, { partyName: 'asc' }]
    else if (sortParam === 'due-old') orderBy = { dueDate: 'asc' }
    else if (sortParam === 'due-new') orderBy = { dueDate: 'desc' }

    const [bills, total] = await Promise.all([
      db.tallyOutstanding.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.tallyOutstanding.count({ where }),
    ])

    // Calculate totals
    const totals = await db.tallyOutstanding.groupBy({
      by: ['type'],
      where: firm ? { firmCode: firm } : {},
      _sum: { closingBalance: true },
    })

    let totalReceivable = 0, totalPayable = 0
    for (const t of totals) {
      if (t.type === 'receivable') totalReceivable = t._sum.closingBalance || 0
      if (t.type === 'payable') totalPayable = t._sum.closingBalance || 0
    }

    // Sum for filtered results
    const totalAmount = bills.reduce((s: number, b: any) => s + Math.abs(b.closingBalance || 0), 0)

    const resp = NextResponse.json({ bills, total, totalReceivable, totalPayable, totalAmount })
    resp.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return resp
  } catch {
    return NextResponse.json({ bills: [], total: 0, totalReceivable: 0, totalPayable: 0 })
  }
}
