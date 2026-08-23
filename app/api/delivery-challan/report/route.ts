export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET /api/delivery-challan/report?from=YYYY-MM-DD&to=YYYY-MM-DD
// Date-range filter ONLY — grouping / merging / totals are done in the page,
// mirroring /api/dyeing/production-report's split of responsibilities.
//
// Lots come back as RAW challan lines (one per FinishDeliveryChallanLine): the
// same lot legitimately appears several times on one challan under different
// dye slips, and the report merges them client-side.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dateFrom = req.nextUrl.searchParams.get('from')
  const dateTo = req.nextUrl.searchParams.get('to')
  if (!dateFrom || !dateTo) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  // Same UTC-midnight → end-of-day treatment as the production report: challan
  // dates are stored as UTC midnight of the picked day, so a UTC range hits
  // exactly the intended calendar days regardless of the server's timezone.
  const from = new Date(dateFrom)
  const to = new Date(dateTo)
  to.setUTCHours(23, 59, 59, 999)

  const challans = await db.finishDeliveryChallan.findMany({
    where: { date: { gte: from, lte: to } },
    select: {
      challanNo: true,
      date: true,
      status: true,
      party: { select: { name: true } },
      lines: {
        select: {
          lotNo: true,
          qualityName: true,
          than: true,
          // Source dye slip for this line — the reason one lot repeats.
          finishEntryLot: { select: { dyeingEntry: { select: { slipNo: true } } } },
        },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { challanNo: 'desc' },
  })

  // Marka isn't snapshotted on the challan line — resolve it per lot from the
  // grey-inward record in one batched lookup (same approach as the DC list).
  const lotNos = [
    ...new Set((challans as any[]).flatMap((c: any) => c.lines.map((l: any) => l.lotNo as string))),
  ] as string[]
  const markaByLot = new Map<string, string>()
  if (lotNos.length) {
    const greys = await db.greyEntry.findMany({
      where: { lotNo: { in: lotNos, mode: 'insensitive' } },
      select: { lotNo: true, marka: true },
    })
    for (const g of greys as any[]) {
      const k = String(g.lotNo).toLowerCase().trim()
      if (g.marka && !markaByLot.has(k)) markaByLot.set(k, g.marka)
    }
  }

  const out = (challans as any[]).map((c: any) => ({
    no: c.challanNo,
    party: c.party?.name ?? 'Unknown',
    date: c.date,
    status: c.status,
    lots: c.lines.map((l: any) => ({
      lot: l.lotNo,
      marka: markaByLot.get(String(l.lotNo).toLowerCase().trim()) ?? '',
      quality: l.qualityName ?? '',
      dyeSlip: l.finishEntryLot?.dyeingEntry?.slipNo != null ? String(l.finishEntryLot.dyeingEntry.slipNo) : '',
      than: l.than,
    })),
  }))

  return NextResponse.json({ challans: out })
}
