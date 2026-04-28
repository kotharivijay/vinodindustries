export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const po = await db.invPO.findUnique({
    where: { id: Number(params.id) },
    include: {
      party: true,
      lines: { include: { item: true }, orderBy: { lineNo: 'asc' } },
      challans: { select: { id: true, challanNo: true, challanDate: true, status: true } },
    },
  })
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(po)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = Number(params.id)
  const body = await req.json()
  const data: any = {}
  for (const k of ['terms', 'notes', 'status'] as const) {
    if (body[k] !== undefined) data[k] = body[k] || null
  }
  if (body.expectedDate !== undefined) data.expectedDate = body.expectedDate ? new Date(body.expectedDate) : null
  const updated = await db.invPO.update({ where: { id }, data })
  return NextResponse.json(updated)
}
