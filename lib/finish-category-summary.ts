// Flat "Colour Category → lots (with than)" summary for a Finish Program.
//
// Each contributing lot's colour category comes from its dyeing slip's shade
// (Shade.colorCategory), resolved through the same allocator the print page
// uses so the numbers reconcile with the Lot Summary. Two entry points:
//   • summariseCategoriesByLot(foldGroups) — pure; for callers that already ran
//     the allocator (the print page).
//   • resolveFinishCategoryLotSummary(lots) — async; fetches the dyeing slips,
//     runs the allocator, and summarises (the on-screen detail page).

import { prisma } from './prisma'
import { allocateFpToDyeingSlips } from './finish-slip-allocator'
import { buildShadeCategoryMap } from './shade-category'

// "Dark" is stored on the master; the shop floor calls it "Deep". Order is the
// print order: Deep → Medium → Light. (Mirrors the print page's CATEGORY_ORDER.)
export const CATEGORY_ORDER: { key: string; label: string }[] = [
  { key: 'Dark', label: 'Deep' },
  { key: 'Medium', label: 'Medium' },
  { key: 'Light', label: 'Light' },
]

export interface CategoryLotSummary {
  label: string // 'Deep' | 'Medium' | 'Light' | 'Uncategorised'
  total: number
  lots: { lotNo: string; than: number }[]
}

// Minimal structural input so both the allocator's AllocatedFoldGroup[] and the
// print page's re-mapped fold groups satisfy it.
interface CategorisableFoldGroup {
  slips: { shadeColorCategory: string | null; lots: { lotNo: string; than: number }[] }[]
}

const UNCATEGORISED = '__none__'

function buildEntry(label: string, perLot: Map<string, number>): CategoryLotSummary {
  const lots = Array.from(perLot.entries())
    .map(([lotNo, than]) => ({ lotNo, than }))
    .sort((a, b) => a.lotNo.localeCompare(b.lotNo))
  return { label, total: lots.reduce((s, l) => s + l.than, 0), lots }
}

/** Allocator fold-groups → flat category→lots summary (Deep→Medium→Light, then Uncategorised). */
export function summariseCategoriesByLot(foldGroups: CategorisableFoldGroup[]): CategoryLotSummary[] {
  // category key → (lotNo → summed than). A lot split across shades of the same
  // category is merged; if it spans two categories it shows under each (rare).
  const byCat = new Map<string, Map<string, number>>()
  for (const fg of foldGroups) {
    for (const s of fg.slips) {
      const cat = s.shadeColorCategory ?? UNCATEGORISED
      for (const l of s.lots) {
        if (!byCat.has(cat)) byCat.set(cat, new Map())
        const m = byCat.get(cat)!
        m.set(l.lotNo, (m.get(l.lotNo) ?? 0) + l.than)
      }
    }
  }

  const out: CategoryLotSummary[] = []
  for (const { key, label } of CATEGORY_ORDER) {
    if (byCat.has(key)) out.push(buildEntry(label, byCat.get(key)!))
  }
  // Lots whose shade carried no colour category — shown last so totals still
  // reconcile with the Lot Summary.
  if (byCat.has(UNCATEGORISED)) out.push(buildEntry('Uncategorised', byCat.get(UNCATEGORISED)!))
  return out
}

/** Fetch contributing dyeing slips, run the allocator, and summarise by category. */
export async function resolveFinishCategoryLotSummary(
  lots: { id?: number; lotNo: string; than: number; dyeingEntryId?: number | null }[],
): Promise<CategoryLotSummary[]> {
  const lotNos = lots.map(l => l.lotNo)
  if (!lotNos.length) return []
  const db = prisma as any

  const dyeingEntries = await db.dyeingEntry.findMany({
    where: { OR: [{ lotNo: { in: lotNos } }, { lots: { some: { lotNo: { in: lotNos } } } }] },
    select: {
      id: true,
      slipNo: true,
      shadeName: true,
      shadeDescription: true,
      lots: { select: { lotNo: true, than: true } },
      foldBatch: {
        select: {
          shadeDescription: true,
          foldProgram: { select: { foldNo: true } },
          shade: { select: { name: true, description: true, colorCategory: true } },
        },
      },
    },
    orderBy: { slipNo: 'desc' },
    distinct: ['id'],
  })

  const categoryByShadeName = await buildShadeCategoryMap()
  const foldGroups = allocateFpToDyeingSlips(
    lots.map(l => ({ id: l.id, lotNo: l.lotNo, than: Number(l.than), dyeingEntryId: l.dyeingEntryId ?? null })),
    dyeingEntries.map((de: any) => ({
      id: de.id,
      slipNo: de.slipNo,
      shadeName: de.shadeName ?? null,
      shadeDescription: de.shadeDescription ?? null,
      lots: de.lots,
      foldBatch: de.foldBatch ?? null,
    })),
    categoryByShadeName,
  )

  return summariseCategoriesByLot(foldGroups)
}
