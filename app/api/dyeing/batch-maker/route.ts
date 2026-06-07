export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCurrentFy } from '@/lib/inv/series'

const db = prisma as any

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const slips = await db.batchMakingSlip.findMany({
    orderBy: { serialNo: 'desc' },
    include: {
      batches: {
        include: {
          foldBatch: {
            include: {
              lots: true,
              foldProgram: { select: { foldNo: true, date: true } },
            },
          },
        },
      },
      _count: { select: { batches: true } },
    },
  })
  return NextResponse.json(slips)
}

type IncomingBatch = {
  foldBatchId: number
  foldNo: string
  batchNo: number
  shadeName: string | null
  marka: string | null
  totalThan: number
  totalWeight: number
  jetNo: number | null
  jetSerial: number | null
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const dateStr = String(body?.date ?? '').trim()
  const batchMakerName = String(body?.batchMakerName ?? '').trim()
  const notes = body?.notes ? String(body.notes).trim() : null
  const rawBatches: any[] = Array.isArray(body?.batches) ? body.batches : []

  if (!dateStr) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!batchMakerName) return NextResponse.json({ error: 'Batch maker name required' }, { status: 400 })
  if (rawBatches.length === 0) return NextResponse.json({ error: 'Pick at least one batch' }, { status: 400 })

  const batches: IncomingBatch[] = []
  for (const b of rawBatches) {
    const foldBatchId = Number(b?.foldBatchId)
    if (!Number.isFinite(foldBatchId)) continue
    const jetNoRaw = b?.jetNo
    const jetSerialRaw = b?.jetSerial
    const jetNo =
      jetNoRaw == null || jetNoRaw === '' ? null : Math.max(1, Math.min(9, Math.floor(Number(jetNoRaw))))
    const jetSerial =
      jetSerialRaw == null || jetSerialRaw === '' ? null : Math.max(1, Math.min(6, Math.floor(Number(jetSerialRaw))))
    batches.push({
      foldBatchId,
      foldNo: String(b?.foldNo ?? ''),
      batchNo: Number(b?.batchNo ?? 0),
      shadeName: b?.shadeName ? String(b.shadeName) : null,
      marka: b?.marka ? String(b.marka) : null,
      totalThan: Number(b?.totalThan ?? 0),
      totalWeight: Number(b?.totalWeight ?? 0),
      jetNo: Number.isFinite(jetNo as number) ? (jetNo as number) : null,
      jetSerial: Number.isFinite(jetSerial as number) ? (jetSerial as number) : null,
    })
  }
  if (batches.length === 0) return NextResponse.json({ error: 'No valid batches' }, { status: 400 })

  // Verify the FoldBatches exist and aren't already on an active BM slip.
  // The partial unique index on BatchMakingSlipBatch.foldBatchId is the real
  // race guard inside the transaction; this is just a friendlier error path.
  const ids = batches.map(b => b.foldBatchId)
  const existing = await db.foldBatch.findMany({
    where: { id: { in: ids } },
    select: { id: true, cancelled: true },
  })
  if (existing.length !== ids.length) {
    return NextResponse.json({ error: 'Some batches no longer exist' }, { status: 400 })
  }
  if (existing.some((b: any) => b.cancelled)) {
    return NextResponse.json({ error: 'Cancelled batches can\'t be put on a BM slip' }, { status: 400 })
  }

  const alreadyOnSlip = await db.batchMakingSlipBatch.findMany({
    where: { foldBatchId: { in: ids }, slipStatus: 'confirmed' },
    select: { foldBatchId: true, slip: { select: { slipNo: true } } },
  })
  if (alreadyOnSlip.length > 0) {
    const sample = alreadyOnSlip[0]
    return NextResponse.json({
      error: `Batch already on ${sample.slip?.slipNo ?? 'another BM slip'}`,
    }, { status: 409 })
  }

  const fy = getCurrentFy()

  try {
    const slip = await db.$transaction(async (tx: any) => {
      const counter = await tx.invSeriesCounter.upsert({
        where: { seriesType_fy: { seriesType: 'batch-maker', fy } },
        create: { seriesType: 'batch-maker', fy, lastNo: 1 },
        update: { lastNo: { increment: 1 } },
      })
      const serialNo = counter.lastNo
      const slipNo = `BM-${serialNo}`

      // Clear this user's in-progress draft (if any) atomically with the
      // real save so they get a fresh picker on next open.
      if (session.user?.email) {
        await tx.batchMakingDraft.deleteMany({
          where: { userEmail: session.user.email },
        })
      }

      return tx.batchMakingSlip.create({
        data: {
          slipNo,
          serialNo,
          fy,
          date: new Date(dateStr),
          batchMakerName,
          notes,
          batches: {
            create: batches.map(b => ({
              foldBatchId: b.foldBatchId,
              foldNoSnapshot: b.foldNo,
              batchNoSnapshot: b.batchNo,
              shadeNameSnapshot: b.shadeName,
              markaSnapshot: b.marka,
              totalThanSnapshot: b.totalThan,
              totalWeightSnapshot: b.totalWeight,
              jetNo: b.jetNo,
              jetSerial: b.jetSerial,
            })),
          },
        },
        include: {
          batches: {
            include: {
              foldBatch: { include: { lots: true } },
            },
          },
        },
      })
    })

    return NextResponse.json(slip)
  } catch (err: any) {
    // Partial unique index trips here when two saves race on the same batch
    if (err?.code === 'P2002') {
      return NextResponse.json({
        error: 'Another batch maker just claimed one of these batches — refresh and try again',
      }, { status: 409 })
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to save' }, { status: 500 })
  }
}
