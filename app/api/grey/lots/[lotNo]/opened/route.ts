export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Lot-wide "physically opened" toggle. A single click on the Stock Summary
 * card flips every GreyEntry for the lot — operators think in lots, not in
 * individual bales, so we set/clear the flag on all matching rows at once.
 *
 *   POST   /api/grey/lots/{lotNo}/opened    → mark opened (now)
 *   DELETE /api/grey/lots/{lotNo}/opened    → unmark
 *
 * lotNo is matched case-insensitively to mirror how the rest of the grey
 * module treats lot identifiers.
 */

async function findEntries(lotNo: string) {
  return db.greyEntry.findMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, openedAt: true },
  })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ lotNo: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lotNo: raw } = await params
  const lotNo = decodeURIComponent(raw || '').trim()
  if (!lotNo) return NextResponse.json({ error: 'lotNo required', code: 'BAD_INPUT' }, { status: 400 })

  const matches = await findEntries(lotNo)
  if (matches.length === 0) {
    return NextResponse.json({ error: `Lot ${lotNo} not found`, code: 'NOT_FOUND' }, { status: 404 })
  }

  const now = new Date()
  const email = (session.user as any)?.email || null
  const result = await db.greyEntry.updateMany({
    where: { id: { in: matches.map((m: any) => m.id) } },
    data: { openedAt: now, openedByEmail: email },
  })

  return NextResponse.json({
    ok: true,
    lotNo,
    rowsUpdated: result.count ?? 0,
    openedAt: now.toISOString(),
    openedByEmail: email,
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ lotNo: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lotNo: raw } = await params
  const lotNo = decodeURIComponent(raw || '').trim()
  if (!lotNo) return NextResponse.json({ error: 'lotNo required', code: 'BAD_INPUT' }, { status: 400 })

  const matches = await findEntries(lotNo)
  if (matches.length === 0) {
    return NextResponse.json({ error: `Lot ${lotNo} not found`, code: 'NOT_FOUND' }, { status: 404 })
  }

  const result = await db.greyEntry.updateMany({
    where: { id: { in: matches.map((m: any) => m.id) } },
    data: { openedAt: null, openedByEmail: null },
  })

  return NextResponse.json({ ok: true, lotNo, rowsUpdated: result.count ?? 0 })
}
