export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST — upsert multiple reservations in one transaction
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { items } = await req.json() as {
    items: { lotNo: string; usedThan: number; note?: string }[]
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 })
  }

  const updatedBy = session.user?.email ?? 'unknown'

  await (prisma as any).$transaction(
    items.map(({ lotNo, usedThan, note }) =>
      usedThan > 0
        ? (prisma as any).lotManualReservation.upsert({
            where: { lotNo },
            update: { usedThan, note: note ?? null, updatedBy },
            create: { lotNo, usedThan, note: note ?? null, updatedBy },
          })
        : (prisma as any).lotManualReservation.deleteMany({
            where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
          })
    )
  )

  return NextResponse.json({ ok: true, count: items.length })
}
