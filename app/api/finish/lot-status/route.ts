import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// PATCH — update lot status (done/partial/pending)
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const body = await req.json()
  const { lotId, status, doneThan } = body

  if (!lotId) return NextResponse.json({ error: 'lotId required' }, { status: 400 })

  const lot = await db.finishEntryLot.findUnique({ where: { id: parseInt(lotId) } })
  if (!lot) return NextResponse.json({ error: 'Lot not found' }, { status: 404 })

  const data: any = {}

  if (status === 'done') {
    data.status = 'done'
    data.doneThan = lot.than
  } else if (status === 'partial') {
    const dt = parseInt(doneThan)
    if (isNaN(dt) || dt <= 0) return NextResponse.json({ error: 'doneThan must be > 0' }, { status: 400 })
    if (dt >= lot.than) {
      data.status = 'done'
      data.doneThan = lot.than
    } else {
      data.status = 'partial'
      data.doneThan = dt
    }
  } else if (status === 'pending') {
    data.status = 'pending'
    data.doneThan = 0
  } else {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const updated = await db.finishEntryLot.update({
    where: { id: parseInt(lotId) },
    data,
  })
  return NextResponse.json(updated)
}
