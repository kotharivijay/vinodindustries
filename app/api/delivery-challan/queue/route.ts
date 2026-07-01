export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// Queue = finished FELs for Pali PC Job parties that don't yet have a
// FinishDeliveryChallanLine. Non-PC parties continue on the legacy
// FinishEntry.finishDespSlipNo flow and are not surfaced here.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // FELs already on a challan — exclude these
  const consumedIds = new Set<number>(
    (await db.finishDeliveryChallanLine.findMany({ select: { finishEntryLotId: true } }))
      .map((l: any) => l.finishEntryLotId),
  )

  // Pull FELs that are done / partial and their finish entry
  const fels = await db.finishEntryLot.findMany({
    where: { status: { in: ['done', 'partial'] } },
    select: {
      id: true,
      lotNo: true,
      than: true,
      doneThan: true,
      status: true,
      dyeingEntry: {
        select: {
          shadeName: true,
          foldBatch: { select: { shade: { select: { name: true, description: true, colorCategory: true } } } },
        },
      },
      entry: {
        select: {
          id: true,
          slipNo: true,
          date: true,
        },
      },
    },
    orderBy: { entry: { slipNo: 'desc' } },
  })

  // Resolve party + quality per lot from grey / OB
  const lotNos: string[] = [...new Set((fels as any[]).map((f: any) => f.lotNo as string))]
  const [greys, obs] = await Promise.all([
    db.greyEntry.findMany({
      where: { lotNo: { in: lotNos, mode: 'insensitive' } },
      select: { lotNo: true, party: { select: { id: true, name: true, tag: true } }, quality: { select: { name: true } } },
    }),
    db.lotOpeningBalance.findMany({
      where: { lotNo: { in: lotNos, mode: 'insensitive' } },
      select: { lotNo: true, party: true, quality: true },
    }),
  ])
  const infoByLot = new Map<string, { partyId: number | null; partyName: string; partyTag: string | null; quality: string }>()
  for (const g of greys as any[]) {
    const k = g.lotNo.toLowerCase().trim()
    if (!infoByLot.has(k)) infoByLot.set(k, {
      partyId: g.party?.id ?? null,
      partyName: g.party?.name ?? 'Unknown',
      partyTag: g.party?.tag ?? null,
      quality: g.quality?.name ?? '-',
    })
  }
  // OB rows carry names — resolve to id + tag via a lookup
  const missing = (obs as any[]).filter((o: any) => o.party && !infoByLot.has(o.lotNo.toLowerCase().trim()))
  if (missing.length) {
    const names: string[] = [...new Set(missing.map((m: any) => m.party as string))]
    const parties = await db.party.findMany({ where: { name: { in: names } }, select: { id: true, name: true, tag: true } })
    const pMap = new Map<string, any>((parties as any[]).map((p: any) => [p.name, p]))
    for (const o of missing) {
      const p = pMap.get(o.party as string)
      infoByLot.set(o.lotNo.toLowerCase().trim(), {
        partyId: p?.id ?? null,
        partyName: p?.name ?? o.party,
        partyTag: p?.tag ?? null,
        quality: o.quality ?? '-',
      })
    }
  }

  // Build queue: Party -> FP -> [{lot, category, than, meter, felId}]
  type Row = {
    felId: number
    lotNo: string
    than: number
    meter: number | null
    quality: string
    shade: string | null
    shadeCategory: string | null
  }
  type FpBucket = {
    finishEntryId: number
    finishSlipNo: number
    date: Date | null
    totalThan: number
    rows: Row[]
  }
  type PartyBucket = {
    partyId: number
    partyName: string
    partyTag: string | null
    totalThan: number
    finishPrograms: Map<number, FpBucket>
  }
  const parties = new Map<number, PartyBucket>()

  for (const f of fels as any[]) {
    if (consumedIds.has(f.id)) continue
    const info = infoByLot.get(f.lotNo.toLowerCase().trim())
    if (!info || !info.partyId) continue
    // Only Pali PC Job parties surface here — the mockup's regular-party
    // group stays on the legacy finishDespSlipNo flow.
    if (info.partyTag !== 'Pali PC Job') continue

    const shadeName = f.dyeingEntry?.shadeName || f.dyeingEntry?.foldBatch?.shade?.name || null
    const shadeCategory = f.dyeingEntry?.foldBatch?.shade?.colorCategory || null
    const rowThan = f.status === 'done' ? f.than : f.doneThan

    if (!parties.has(info.partyId)) {
      parties.set(info.partyId, {
        partyId: info.partyId,
        partyName: info.partyName,
        partyTag: info.partyTag,
        totalThan: 0,
        finishPrograms: new Map(),
      })
    }
    const pb = parties.get(info.partyId)!
    pb.totalThan += rowThan

    if (!pb.finishPrograms.has(f.entry.id)) {
      pb.finishPrograms.set(f.entry.id, {
        finishEntryId: f.entry.id,
        finishSlipNo: f.entry.slipNo,
        date: f.entry.date,
        totalThan: 0,
        rows: [],
      })
    }
    const fp = pb.finishPrograms.get(f.entry.id)!
    fp.totalThan += rowThan
    fp.rows.push({
      felId: f.id,
      lotNo: f.lotNo,
      than: rowThan,
      meter: f.meter ?? null,
      quality: info.quality,
      shade: shadeName,
      shadeCategory,
    })
  }

  // Serialize: sorted arrays
  const out = [...parties.values()]
    .sort((a, b) => a.partyName.localeCompare(b.partyName))
    .map(pb => ({
      partyId: pb.partyId,
      partyName: pb.partyName,
      partyTag: pb.partyTag,
      totalThan: pb.totalThan,
      finishPrograms: [...pb.finishPrograms.values()]
        .sort((a, b) => b.finishSlipNo - a.finishSlipNo)
        .map(fp => ({
          finishEntryId: fp.finishEntryId,
          finishSlipNo: fp.finishSlipNo,
          date: fp.date,
          totalThan: fp.totalThan,
          rows: fp.rows.sort((a, b) => a.lotNo.localeCompare(b.lotNo)),
        })),
    }))

  return NextResponse.json({ parties: out })
}
