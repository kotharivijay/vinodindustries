export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET — list all reservations (for client hydration)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const reservations = await (prisma as any).lotManualReservation.findMany()
  return NextResponse.json(reservations)
}

// POST — upsert reservation for a lot
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lotNo, usedThan, note } = await req.json()
  if (!lotNo || typeof usedThan !== 'number' || usedThan < 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const reservation = await (prisma as any).lotManualReservation.upsert({
    where: { lotNo },
    update: { usedThan, note: note ?? null, updatedBy: session.user?.email ?? 'unknown' },
    create: { lotNo, usedThan, note: note ?? null, updatedBy: session.user?.email ?? 'unknown' },
  })
  return NextResponse.json(reservation)
}

// DELETE — remove reservation for a lot
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lotNo } = await req.json()
  if (!lotNo) return NextResponse.json({ error: 'lotNo required' }, { status: 400 })

  await (prisma as any).lotManualReservation.deleteMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
  })
  return NextResponse.json({ ok: true })
}
