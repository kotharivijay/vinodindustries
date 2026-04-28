import { prisma } from '@/lib/prisma'

/**
 * Atomic, gap-free sequential series allocator.
 * Wraps Prisma's interactive transaction with `UPDATE ... RETURNING`
 * semantics on the InvSeriesCounter row.
 *
 *   const { no, fy } = await allocateSeries('inward')   // → 23, '2026-27'
 *
 * Cancelled challans must NOT call this (they keep their original number);
 * deletion is soft (status='Cancelled') so the series stays gap-free.
 */
export function getCurrentFy(now: Date = new Date()): string {
  const y = now.getFullYear()
  const isAprOrLater = now.getMonth() >= 3 // April = 3
  const start = isAprOrLater ? y : y - 1
  const end = (start + 1) % 100
  return `${start}-${String(end).padStart(2, '0')}`
}

export async function allocateSeries(seriesType: string, fy?: string) {
  const _fy = fy || getCurrentFy()
  const db = prisma as any
  const row = await db.$transaction(async (tx: any) => {
    return tx.invSeriesCounter.upsert({
      where: { seriesType_fy: { seriesType, fy: _fy } },
      create: { seriesType, fy: _fy, lastNo: 1 },
      update: { lastNo: { increment: 1 } },
    })
  })
  return { no: row.lastNo, fy: _fy }
}

/**
 * Peek the next number without incrementing — for UI display only.
 * Result may be stale if another request increments between peek and save.
 */
export async function peekNextSeries(seriesType: string, fy?: string) {
  const _fy = fy || getCurrentFy()
  const db = prisma as any
  const row = await db.invSeriesCounter.findUnique({
    where: { seriesType_fy: { seriesType, fy: _fy } },
  })
  return { no: (row?.lastNo ?? 0) + 1, fy: _fy }
}

/**
 * Series-gap report: returns numbers from 1..lastNo and which ones are
 * present (active or cancelled) vs missing (governance red flag).
 */
export async function seriesGapReport(seriesType: string, fy: string) {
  const db = prisma as any
  const counter = await db.invSeriesCounter.findUnique({
    where: { seriesType_fy: { seriesType, fy } },
  })
  if (!counter) return { fy, lastNo: 0, used: [], missing: [] }

  if (seriesType !== 'inward') {
    return { fy, lastNo: counter.lastNo, used: [], missing: [] }
  }

  const challans = await db.invChallan.findMany({
    where: { seriesFy: fy },
    select: { internalSeriesNo: true, status: true, challanNo: true, partyId: true },
    orderBy: { internalSeriesNo: 'asc' },
  })
  const usedSet = new Set(challans.map((c: any) => c.internalSeriesNo))
  const missing: number[] = []
  for (let n = 1; n <= counter.lastNo; n++) {
    if (!usedSet.has(n)) missing.push(n)
  }
  return { fy, lastNo: counter.lastNo, used: challans, missing }
}
