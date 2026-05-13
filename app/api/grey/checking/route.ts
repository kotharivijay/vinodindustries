export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const slips = await db.checkingSlip.findMany({
    orderBy: { date: 'desc' },
    include: { lots: true, _count: { select: { lots: true } } },
  })
  return NextResponse.json(slips)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const slipNo = String(body?.slipNo ?? '').trim()
  const dateStr = String(body?.date ?? '').trim()
  const checkerName = String(body?.checkerName ?? '').trim()
  const notes = body?.notes ? String(body.notes).trim() : null
  const greyEntryIds: number[] = Array.isArray(body?.greyEntryIds)
    ? body.greyEntryIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
    : []

  if (!slipNo) return NextResponse.json({ error: 'Slip No required' }, { status: 400 })
  if (!dateStr) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!checkerName) return NextResponse.json({ error: 'Checker name required' }, { status: 400 })
  if (greyEntryIds.length === 0) return NextResponse.json({ error: 'Pick at least one lot' }, { status: 400 })

  // Snapshot the selected GreyEntry rows so the slip stays stable even if the
  // grey row is edited later.
  const entries = await db.greyEntry.findMany({
    where: { id: { in: greyEntryIds } },
    select: { id: true, lotNo: true, than: true, baleNo: true },
  })
  if (entries.length !== greyEntryIds.length) {
    return NextResponse.json({ error: 'Some grey entries no longer exist' }, { status: 400 })
  }

  try {
    const slip = await db.checkingSlip.create({
      data: {
        slipNo,
        date: new Date(dateStr),
        checkerName,
        notes,
        lots: {
          create: entries.map((e: any) => ({
            greyEntryId: e.id,
            lotNo: e.lotNo,
            than: e.than,
            baleNo: e.baleNo,
          })),
        },
      },
      include: { lots: true },
    })
    return NextResponse.json(slip)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: `Slip No "${slipNo}" already used` }, { status: 409 })
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to save' }, { status: 500 })
  }
}
