export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const inv = await db.invPurchaseInvoice.findUnique({
    where: { id: Number(params.id) },
    include: {
      party: true,
      lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } },
      challans: { include: { challan: { select: { id: true, challanNo: true, challanDate: true, internalSeriesNo: true, seriesFy: true } } } },
    },
  })
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(inv)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = Number(params.id)
  const body = await req.json()
  const data: any = {}
  for (const k of ['notes', 'status'] as const) {
    if (body[k] !== undefined) data[k] = body[k] || null
  }
  const updated = await db.invPurchaseInvoice.update({ where: { id }, data })
  return NextResponse.json(updated)
}
