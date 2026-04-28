export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchAliasesFromTally } from '@/lib/inv/tally-masters'

export const maxDuration = 60

const db = prisma as any

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let fetched
  try { fetched = await fetchAliasesFromTally() }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 502 }) }

  let inserted = 0, updated = 0
  for (const a of fetched) {
    const existing = await db.invTallyAlias.findUnique({ where: { tallyStockItem: a.tallyStockItem } })
    if (existing) {
      await db.invTallyAlias.update({
        where: { tallyStockItem: a.tallyStockItem },
        data: {
          tallyGuid: a.tallyGuid,
          unit: a.unit,
          gstRate: a.gstRate,
          hsn: a.hsn,
          // Keep manual category/trackStock overrides; Tally just refreshes facts.
          lastSyncedAt: new Date(),
        },
      })
      updated++
    } else {
      await db.invTallyAlias.create({
        data: {
          tallyStockItem: a.tallyStockItem,
          tallyGuid: a.tallyGuid,
          displayName: a.tallyStockItem,
          category: a.category,
          unit: a.unit,
          gstRate: a.gstRate,
          hsn: a.hsn,
          defaultTrackStock: a.defaultTrackStock,
          lastSyncedAt: new Date(),
        },
      })
      inserted++
    }
  }
  return NextResponse.json({ ok: true, inserted, updated, total: fetched.length })
}
