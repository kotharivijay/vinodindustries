import { prisma } from '@/lib/prisma'

export interface LotInfo {
  party: string | null
  quality: string | null
  weight: string | null
  marka: string | null
  mtrPerThan: number | null
}

/**
 * Build a map of lotNo → { party, quality, weight } from GreyEntry + LotOpeningBalance fallback.
 * Handles carry-forward lots that have no GreyEntry.
 */
export async function buildLotInfoMap(lotNos: string[]): Promise<Map<string, LotInfo>> {
  if (lotNos.length === 0) return new Map()

  const db = prisma as any
  const map = new Map<string, LotInfo>()

  // 1. GreyEntry (primary source)
  const greyEntries = await prisma.greyEntry.findMany({
    where: { lotNo: { in: lotNos } },
    select: { lotNo: true, weight: true, marka: true, grayMtr: true, than: true, party: { select: { name: true } }, quality: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  for (const g of greyEntries) {
    const mtrPerThan = g.grayMtr && g.than ? g.grayMtr / g.than : null
    map.set(g.lotNo.toLowerCase().trim(), { party: g.party.name, quality: g.quality.name, weight: g.weight, marka: g.marka || null, mtrPerThan })
  }

  // 2. LotOpeningBalance fallback for lots not found in GreyEntry
  const missingLots = lotNos.filter(l => !map.has(l.toLowerCase().trim()))
  if (missingLots.length > 0) {
    try {
      const obEntries = await db.lotOpeningBalance.findMany({
        where: { lotNo: { in: missingLots } },
        select: { lotNo: true, party: true, quality: true, weight: true, marka: true, grayMtr: true, greyThan: true },
      })
      for (const ob of obEntries) {
        const key = ob.lotNo.toLowerCase().trim()
        if (!map.has(key)) {
          const obMtrPerThan = ob.grayMtr && ob.greyThan ? ob.grayMtr / ob.greyThan : null
          map.set(key, { party: ob.party || null, quality: ob.quality || null, weight: ob.weight || null, marka: ob.marka || null, mtrPerThan: obMtrPerThan })
        }
      }
    } catch {}
  }

  // 3. ReProcessLot fallback for RE-PRO-* lots
  const reproLots = lotNos.filter(l => l.toUpperCase().startsWith('RE-PRO-') && !map.has(l.toLowerCase().trim()))
  if (reproLots.length > 0) {
    try {
      const reproEntries = await db.reProcessLot.findMany({
        where: { reproNo: { in: reproLots, mode: 'insensitive' } },
        select: { reproNo: true, quality: true, weight: true, grayMtr: true, totalThan: true },
      })
      for (const r of reproEntries) {
        const key = r.reproNo.toLowerCase().trim()
        if (!map.has(key)) {
          const mtrPerThan = r.grayMtr && r.totalThan ? r.grayMtr / r.totalThan : null
          map.set(key, { party: 'Re-Process', quality: r.quality || null, weight: r.weight || null, marka: null, mtrPerThan })
        }
      }
    } catch {}
  }

  return map
}
