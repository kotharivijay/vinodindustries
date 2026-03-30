import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const p = req.nextUrl.searchParams
  const firm = p.get('firm') || ''
  const status = p.get('status') || ''
  const search = p.get('search') || ''
  const party = p.get('party') || ''
  const agent = p.get('agent') || ''
  const item = p.get('item') || ''
  const sort = p.get('sort') || 'date-desc'
  const page = parseInt(p.get('page') || '1')
  const limit = parseInt(p.get('limit') || '50')

  const db = viPrisma as any
  const where: any = {}
  if (firm) where.firmCode = firm
  if (status) where.status = status
  if (party) where.partyName = { contains: party, mode: 'insensitive' }
  if (agent) where.agentName = { contains: agent, mode: 'insensitive' }
  if (item) where.itemName = { contains: item, mode: 'insensitive' }
  if (search) {
    where.OR = [
      { partyName: { contains: search, mode: 'insensitive' } },
      { orderNo: { contains: search, mode: 'insensitive' } },
      { itemName: { contains: search, mode: 'insensitive' } },
      { agentName: { contains: search, mode: 'insensitive' } },
    ]
  }

  let orderBy: any = { id: 'desc' }
  if (sort === 'date-asc') orderBy = { id: 'asc' }
  if (sort === 'balance-desc') orderBy = { balance: 'desc' }
  if (sort === 'party-asc') orderBy = { partyName: 'asc' }

  const [orders, total] = await Promise.all([
    db.salesOrder.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    db.salesOrder.count({ where }),
  ])

  // Summary
  const allWhere = firm ? { firmCode: firm } : {}
  const [totalOrders, pendingCount, closedCount] = await Promise.all([
    db.salesOrder.count({ where: allWhere }),
    db.salesOrder.count({ where: { ...allWhere, status: 'Pending' } }),
    db.salesOrder.count({ where: { ...allWhere, status: 'Closed' } }),
  ])

  const aggs = await db.salesOrder.aggregate({
    where: allWhere,
    _sum: { orderQty: true, dispatchMtr: true, balance: true },
  })

  // Dropdowns
  const [parties, agents, items] = await Promise.all([
    db.salesOrder.findMany({ where: allWhere, select: { partyName: true }, distinct: ['partyName'], orderBy: { partyName: 'asc' } }),
    db.salesOrder.findMany({ where: allWhere, select: { agentName: true }, distinct: ['agentName'], orderBy: { agentName: 'asc' } }),
    db.salesOrder.findMany({ where: allWhere, select: { itemName: true }, distinct: ['itemName'], orderBy: { itemName: 'asc' } }),
  ])

  // Tally agent groups (parent ledger names containing "Agent")
  const tallyAgents = await db.tallyLedger.findMany({
    where: { parent: { contains: 'agent', mode: 'insensitive' } },
    select: { parent: true },
    distinct: ['parent'],
    orderBy: { parent: 'asc' },
  })

  return NextResponse.json({
    orders,
    total,
    summary: {
      total: totalOrders,
      pending: pendingCount,
      closed: closedCount,
      totalQty: aggs._sum?.orderQty || 0,
      dispatchedQty: aggs._sum?.dispatchMtr || 0,
      pendingQty: aggs._sum?.balance || 0,
    },
    dropdowns: {
      parties: parties.map((p: any) => p.partyName).filter(Boolean),
      agents: agents.map((a: any) => a.agentName).filter(Boolean),
      tallyAgents: tallyAgents.map((a: any) => a.parent).filter(Boolean),
      items: items.map((i: any) => i.itemName).filter(Boolean),
    },
  })
}
