import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const p = req.nextUrl.searchParams
  const firm = p.get('firm') || ''
  const tag = p.get('tag') || ''
  const search = p.get('search') || ''
  const sort = p.get('sort') || 'name-asc'
  const page = parseInt(p.get('page') || '1')
  const limit = parseInt(p.get('limit') || '50')

  const db = viPrisma as any
  const where: any = {}
  if (firm) where.firmCode = firm
  if (tag) where.tag = tag
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { mobile1: { contains: search } },
      { mobile2: { contains: search } },
      { contactPerson: { contains: search, mode: 'insensitive' } },
      { agentName: { contains: search, mode: 'insensitive' } },
    ]
  }

  let orderBy: any = { name: 'asc' }
  if (sort === 'name-desc') orderBy = { name: 'desc' }

  const [contacts, total] = await Promise.all([
    db.contact.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    db.contact.count({ where }),
  ])

  return NextResponse.json({ contacts, total })
}
