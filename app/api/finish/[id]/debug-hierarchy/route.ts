export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { allocateFpToDyeingSlips } from '@/lib/finish-slip-allocator'

const db = prisma as any

/**
 * Debug endpoint — returns the same fold→slip→lots hierarchy that the
 * /finish/[id] detail page builds. Useful for confirming whether the page
 * is rendering stale HTML vs producing wrong server output.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const entry = await db.finishEntry.findUnique({
    where: { id: parseInt(id) },
    include: { lots: true },
  })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const lots = entry.lots?.length ? entry.lots
    : [{ id: 0, lotNo: entry.lotNo, than: entry.than, doneThan: 0, status: 'pending' }]
  const lotNos = lots.map((l: any) => l.lotNo)

  const dyeingEntries = await db.dyeingEntry.findMany({
    where: { OR: [{ lotNo: { in: lotNos, mode: 'insensitive' } }, { lots: { some: { lotNo: { in: lotNos, mode: 'insensitive' } } } }] },
    select: {
      slipNo: true, shadeName: true,
      lots: { select: { lotNo: true, than: true } },
      foldBatch: { select: { foldProgram: { select: { foldNo: true } }, shade: { select: { name: true, description: true } } } },
    },
    orderBy: { slipNo: 'desc' },
  })

  const allocatedFolds = allocateFpToDyeingSlips(
    lots.map((l: any) => ({ lotNo: l.lotNo, than: Number(l.than) })),
    dyeingEntries.map((de: any) => ({
      slipNo: de.slipNo,
      shadeName: de.shadeName ?? null,
      lots: de.lots,
      foldBatch: de.foldBatch ?? null,
    })),
  )

  return NextResponse.json({
    fpId: entry.id,
    fpSlipNo: entry.slipNo,
    fpLots: lots.map((l: any) => ({ lotNo: l.lotNo, than: l.than, doneThan: l.doneThan, status: l.status })),
    candidateDyeingSlips: dyeingEntries.map((de: any) => ({
      slipNo: de.slipNo,
      foldNo: de.foldBatch?.foldProgram?.foldNo,
      shade: de.shadeName,
      lots: de.lots.map((dl: any) => `${dl.lotNo}/${dl.than}`),
    })),
    allocated: allocatedFolds,
  })
}
