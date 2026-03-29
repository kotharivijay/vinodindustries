import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'
  const where = activeOnly ? { isActive: true } : {}

  const operators = await db.dyeingOperator.findMany({
    where,
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(operators)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, mobileNo } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  try {
    const operator = await db.dyeingOperator.create({
      data: { name: name.trim(), mobileNo: mobileNo?.trim() || null },
    })
    return NextResponse.json(operator)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Operator name already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, name, mobileNo, isActive } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  const data: any = {}
  if (name !== undefined) data.name = name.trim()
  if (mobileNo !== undefined) data.mobileNo = mobileNo?.trim() || null
  if (isActive !== undefined) data.isActive = isActive

  try {
    const operator = await db.dyeingOperator.update({
      where: { id: parseInt(id) },
      data,
    })
    return NextResponse.json(operator)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Operator name already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
