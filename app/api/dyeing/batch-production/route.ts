export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/dyeing/batch-production?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Batch-making output for the period: than assembled on Batch Maker slips
 * (BM-n), grouped by day / batch maker / jet and listed slip-by-slip.
 * Cancelled slips (BatchMakingSlip.status / BatchMakingSlipBatch.slipStatus)
 * and fold batches cancelled AFTER the slip was cut (FoldBatch.cancelled) are
 * excluded, so the totals are what is really queued for dyeing.
 * Each batch is tagged with its dyeing state so pending work stands out.
 */
export type DyeStatus = 'not-dyed' | 'in-dyeing' | 'dyed'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const fromStr = sp.get('from') || new Date().toISOString().slice(0, 10)
  const toStr = sp.get('to') || fromStr
  // Same convention as the production-report route: dates are stored at UTC
  // midnight, so the range is [from 00:00Z, to 23:59:59.999Z].
  const from = new Date(fromStr)
  const to = new Date(toStr)
  to.setUTCHours(23, 59, 59, 999)

  const db = prisma as any
  const rows = await db.batchMakingSlipBatch.findMany({
    where: {
      slipStatus: 'confirmed',
      slip: { status: 'confirmed', date: { gte: from, lte: to } },
      foldBatch: { cancelled: false },
    },
    select: {
      id: true,
      totalThanSnapshot: true, totalWeightSnapshot: true,
      foldNoSnapshot: true, batchNoSnapshot: true, shadeNameSnapshot: true, markaSnapshot: true,
      jetNo: true, jetSerial: true,
      slip: { select: { id: true, slipNo: true, serialNo: true, date: true, batchMakerName: true } },
      foldBatch: {
        select: {
          id: true,
          dyeingEntries: { select: { id: true, slipNo: true, dyeingDoneAt: true }, orderBy: { id: 'asc' } },
          lots: { select: { lotNo: true, than: true, party: { select: { name: true } } } },
        },
      },
    },
  })

  // Batch maker is a free-text snapshot; merge case/space variants and show
  // the spelling used most often.
  const makerKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  const makerSpellings = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const k = makerKey(r.slip.batchMakerName || 'Unknown')
    const disp = (r.slip.batchMakerName || 'Unknown').trim()
    if (!makerSpellings.has(k)) makerSpellings.set(k, new Map())
    const m = makerSpellings.get(k)!
    m.set(disp, (m.get(disp) ?? 0) + 1)
  }
  const makerDisplay = (name: string) => {
    const m = makerSpellings.get(makerKey(name || 'Unknown'))
    if (!m) return name
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  type Item = {
    id: number; foldNo: string; batchNo: number; shade: string | null; marka: string | null
    than: number; weight: number; jet: string | null; party: string | null
    lots: { lotNo: string; than: number }[]
    dyeStatus: DyeStatus; dyeSlipNo: number | null; dyeSlipId: number | null
  }
  type Slip = {
    id: number; slipNo: string; serialNo: number; date: string; maker: string
    batches: number; than: number; weight: number; notDyed: number; notDyedThan: number; inDyeing: number
    items: Item[]
  }

  const slipsById = new Map<number, Slip>()
  for (const r of rows) {
    const entries: { id: number; slipNo: number; dyeingDoneAt: Date | null }[] = r.foldBatch?.dyeingEntries ?? []
    const done = entries.find(e => e.dyeingDoneAt)
    const dyeStatus: DyeStatus = entries.length === 0 ? 'not-dyed' : done ? 'dyed' : 'in-dyeing'
    const dyeRef = done ?? entries[0]
    const dyeSlipNo = dyeRef?.slipNo ?? null
    const dyeSlipId = dyeRef?.id ?? null
    const parties = [...new Set((r.foldBatch?.lots ?? []).map((l: any) => l.party?.name).filter(Boolean))] as string[]
    const item: Item = {
      id: r.id,
      foldNo: r.foldNoSnapshot, batchNo: r.batchNoSnapshot,
      shade: r.shadeNameSnapshot ?? null, marka: r.markaSnapshot ?? null,
      than: r.totalThanSnapshot ?? 0, weight: Number(r.totalWeightSnapshot ?? 0),
      jet: r.jetNo ? `Jet ${r.jetNo}${r.jetSerial ? '/' + r.jetSerial : ''}` : null,
      party: parties.join(', ') || null,
      lots: (r.foldBatch?.lots ?? []).map((l: any) => ({ lotNo: l.lotNo, than: l.than })),
      dyeStatus, dyeSlipNo, dyeSlipId,
    }
    let s = slipsById.get(r.slip.id)
    if (!s) {
      s = {
        id: r.slip.id, slipNo: r.slip.slipNo, serialNo: r.slip.serialNo,
        date: new Date(r.slip.date).toISOString().slice(0, 10),
        maker: makerDisplay(r.slip.batchMakerName || 'Unknown'),
        batches: 0, than: 0, weight: 0, notDyed: 0, notDyedThan: 0, inDyeing: 0, items: [],
      }
      slipsById.set(r.slip.id, s)
    }
    s.items.push(item)
    s.batches += 1
    s.than += item.than
    s.weight += item.weight
    if (dyeStatus === 'not-dyed') { s.notDyed += 1; s.notDyedThan += item.than }
    if (dyeStatus === 'in-dyeing') s.inDyeing += 1
  }

  const slips = [...slipsById.values()].sort((a, b) => b.date.localeCompare(a.date) || b.serialNo - a.serialNo)
  for (const s of slips) s.items.sort((a, b) => a.foldNo.localeCompare(b.foldNo, undefined, { numeric: true }) || a.batchNo - b.batchNo)

  // ── groupings ──
  type Group = { name: string; slips: Set<number>; batches: number; than: number; notDyedThan: number; inDyeingThan: number }
  const group = (key: (s: Slip, i: Item) => string) => {
    const m = new Map<string, Group>()
    for (const s of slips) for (const i of s.items) {
      const k = key(s, i)
      let g = m.get(k)
      if (!g) { g = { name: k, slips: new Set(), batches: 0, than: 0, notDyedThan: 0, inDyeingThan: 0 }; m.set(k, g) }
      g.slips.add(s.id); g.batches += 1; g.than += i.than
      if (i.dyeStatus === 'not-dyed') g.notDyedThan += i.than
      if (i.dyeStatus === 'in-dyeing') g.inDyeingThan += i.than
    }
    return [...m.values()].map(g => ({ name: g.name, slips: g.slips.size, batches: g.batches, than: g.than, notDyedThan: g.notDyedThan, inDyeingThan: g.inDyeingThan }))
  }
  const byDate = group(s => s.date).sort((a, b) => a.name.localeCompare(b.name)).map(g => ({ ...g, date: g.name }))
  const byMaker = group(s => s.maker).sort((a, b) => b.than - a.than)
  const byJet = group((_, i) => i.jet ? i.jet.split('/')[0] : 'No jet').sort((a, b) => b.than - a.than)

  const summary = {
    slips: slips.length,
    batches: slips.reduce((n, s) => n + s.batches, 0),
    than: slips.reduce((n, s) => n + s.than, 0),
    weight: Math.round(slips.reduce((n, s) => n + s.weight, 0) * 100) / 100,
    notDyedBatches: slips.reduce((n, s) => n + s.notDyed, 0),
    notDyedThan: slips.reduce((n, s) => n + s.notDyedThan, 0),
    inDyeingBatches: slips.reduce((n, s) => n + s.inDyeing, 0),
    inDyeingThan: slips.reduce((n, s) => n + s.items.filter(i => i.dyeStatus === 'in-dyeing').reduce((t, i) => t + i.than, 0), 0),
  }

  return NextResponse.json({ from: fromStr, to: toStr, summary, byDate, byMaker, byJet, slips })
}
