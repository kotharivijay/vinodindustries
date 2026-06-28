// Shade colour-category resolution.
//
// A dyeing slip's colour category must come from the slip's ACTUAL shade name
// (the operator-typed `DyeingEntry.shadeName`, the source of truth) looked up
// against the live Shade master — NOT from the `foldBatch.shade` FK. That FK can
// point at a different / renamed master shade (the slip-level shadeName override
// is a supported workflow), which would otherwise drop or mis-assign the
// category. Shade.name is unique, so a name keyed lookup is unambiguous; keying
// case-insensitively tolerates casing drift between the slip text and the
// master. A renamed master simply won't match an old name → null (safe).

import { prisma } from './prisma'

/** lowercased+trimmed Shade.name → colorCategory ('Light'|'Medium'|'Dark'|null). */
export async function buildShadeCategoryMap(): Promise<Map<string, string | null>> {
  const shades = await (prisma as any).shade.findMany({
    select: { name: true, colorCategory: true },
  })
  const map = new Map<string, string | null>()
  for (const s of shades) {
    if (s.name) map.set(s.name.trim().toLowerCase(), s.colorCategory ?? null)
  }
  return map
}

/** Resolve a colour category from the live master by shade name. */
export function categoryForShadeName(
  map: Map<string, string | null> | undefined,
  shadeName: string | null | undefined,
): string | null {
  if (!map || !shadeName) return null
  return map.get(shadeName.trim().toLowerCase()) ?? null
}
