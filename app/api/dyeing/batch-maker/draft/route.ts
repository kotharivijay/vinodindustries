export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// One draft per user, keyed by session email. The whole selection + jet
// tags live in `data` as JSON so we don't need a child table for state
// that gets thrown away on real save.
type DraftBatch = { batchId: number; jetNo?: number | null; jetSerial?: number | null }

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const draft = await db.batchMakingDraft.findUnique({
    where: { userEmail: session.user.email },
  })
  return NextResponse.json(draft)
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const dateStr = String(body?.date ?? '').trim()
  const batchMakerName = String(body?.batchMakerName ?? '').trim()
  if (!dateStr) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!batchMakerName) return NextResponse.json({ error: 'Batch maker name required' }, { status: 400 })

  const rawBatches: any[] = Array.isArray(body?.batches) ? body.batches : []
  const data: DraftBatch[] = rawBatches
    .map(b => ({
      batchId: Number(b?.batchId),
      jetNo: b?.jetNo == null ? null : Number(b.jetNo),
      jetSerial: b?.jetSerial == null ? null : Number(b.jetSerial),
    }))
    .filter(b => Number.isFinite(b.batchId))

  const draft = await db.batchMakingDraft.upsert({
    where: { userEmail: session.user.email },
    update: {
      date: new Date(dateStr),
      batchMakerName,
      notes: body?.notes ? String(body.notes).trim() : null,
      tagMode: !!body?.tagMode,
      data,
    },
    create: {
      userEmail: session.user.email,
      date: new Date(dateStr),
      batchMakerName,
      notes: body?.notes ? String(body.notes).trim() : null,
      tagMode: !!body?.tagMode,
      data,
    },
  })
  return NextResponse.json(draft)
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Idempotent — deleteMany so first-time delete on a non-existent row is OK
  await db.batchMakingDraft.deleteMany({
    where: { userEmail: session.user.email },
  })
  return NextResponse.json({ ok: true })
}
