import { prisma } from '@/lib/prisma'

export interface LotInfo {
  party: string | null
  quality: string | null
  weight: string | null
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
    select: { lotNo: true, weight: true, party: { select: { name: true } }, quality: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  for (const g of greyEntries) {
    map.set(g.lotNo.toLowerCase().trim(), { party: g.party.name, quality: g.quality.name, weight: g.weight })
  }

  // 2. LotOpeningBalance fallback for lots not found in GreyEntry
  const missingLots = lotNos.filter(l => !map.has(l.toLowerCase().trim()))
  if (missingLots.length > 0) {
    try {
      const obEntries = await db.lotOpeningBalance.findMany({
        where: { lotNo: { in: missingLots } },
        select: { lotNo: true, party: true, quality: true, weight: true },
      })
      for (const ob of obEntries) {
        const key = ob.lotNo.toLowerCase().trim()
        if (!map.has(key)) {
          map.set(key, { party: ob.party || null, quality: ob.quality || null, weight: ob.weight || null })
        }
      }
    } catch {}
  }

  return map
}
