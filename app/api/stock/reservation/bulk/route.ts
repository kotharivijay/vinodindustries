export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

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

  // Resolve existing rows case-insensitively up front — a plain upsert on
  // the unique `lotNo` would create duplicate rows when an item's casing
  // differs from the stored one.
  const existingRows = await (prisma as any).lotManualReservation.findMany({
    where: { lotNo: { in: items.map(i => i.lotNo), mode: 'insensitive' } },
    select: { id: true, lotNo: true },
  })
  const existingByLot = new Map<string, number>(
    existingRows.map((r: any) => [r.lotNo.toLowerCase().trim(), r.id]),
  )

  await (prisma as any).$transaction(
    items.map(({ lotNo, usedThan, note }) => {
      const existingId = existingByLot.get(lotNo.toLowerCase().trim())
      if (usedThan > 0) {
        return existingId
          ? (prisma as any).lotManualReservation.update({
              where: { id: existingId },
              data: { usedThan, note: note ?? null, updatedBy },
            })
          : (prisma as any).lotManualReservation.create({
              data: { lotNo: normalizeLotNo(lotNo) ?? '', usedThan, note: note ?? null, updatedBy },
            })
      }
      return (prisma as any).lotManualReservation.deleteMany({
        where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      })
    })
  )

  return NextResponse.json({ ok: true, count: items.length })
}
