export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const entryId = parseInt(id)
  if (isNaN(entryId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const db = prisma as any
  const entry = await db.dyeingEntry.findUnique({ where: { id: entryId } })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { status } = body

  if (!['pending', 'patchy', 're-dyeing', 'done'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updated = await db.dyeingEntry.update({
    where: { id: entryId },
    data: { status },
  })

  return NextResponse.json(updated)
}
