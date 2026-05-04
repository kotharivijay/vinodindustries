export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Per-lot stage totals for the Grey Stock Summary chip strip.
 * Returns a single object keyed by upper-cased lotNo with the than count
 * each stage holds:
 *   {
 *     "PS-53": { fold: 50, dye: 50, finish: 42, pack: 12 },
 *     "PS-54": { fold: 30, dye: 18, finish: 0,  pack: 0 },
 *     ...
 *   }
 *
 * 'desp' and 'grey' aren't included here — those already live on
 * /api/grey (StockSummaryRow.tDesp / .greyThan).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  const [foldRows, dyeRows, finishRows, packRows] = await Promise.all([
    db.foldBatchLot.groupBy({ by: ['lotNo'], _sum: { than: true } }).catch(() => []),
    db.dyeingEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } }).catch(() => []),
    db.finishEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } }).catch(() => []),
    db.packingLot.groupBy({ by: ['lotNo'], _sum: { than: true } }).catch(() => []),
  ])

  const upper = (s: string) => s.trim().toUpperCase()
  const stages: Record<string, { fold: number; dye: number; finish: number; pack: number }> = {}
  const ensure = (k: string) => {
    if (!stages[k]) stages[k] = { fold: 0, dye: 0, finish: 0, pack: 0 }
    return stages[k]
  }

  for (const r of foldRows)   ensure(upper(r.lotNo)).fold   += r._sum.than || 0
  for (const r of dyeRows)    ensure(upper(r.lotNo)).dye    += r._sum.than || 0
  for (const r of finishRows) ensure(upper(r.lotNo)).finish += r._sum.than || 0
  for (const r of packRows)   ensure(upper(r.lotNo)).pack   += r._sum.than || 0

  return NextResponse.json(stages)
}
