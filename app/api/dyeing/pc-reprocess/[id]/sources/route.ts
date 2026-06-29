export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

const db = prisma as any

type SourceInput = {
  sourceDyeingEntryId: number | string
  originalLotNo: string
  than: number | string
  notes?: string | null
}

// POST — append more sources to an existing PC-RP. Only allowed while the
// rework is still in pending-approval or pending (before fold consumes it).
// Re-runs the same per-source validations as the create endpoint and updates
// the PC-RP's partyId/qualityId to NULL ("mixed") if the new sources span
// values different from the existing ones.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const lotId = parseInt(id)
  if (!Number.isFinite(lotId)) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 })

  const existing = await db.pcPaliReprocessLot.findUnique({
    where: { id: lotId },
    include: { sources: true },
  })
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (existing.status !== 'pending-approval' && existing.status !== 'pending') {
    return NextResponse.json({
      error: 'INVALID_STATE',
      message: `Cannot add sources — PC-RP is in status '${existing.status}'. Only 'pending-approval' or 'pending' can be extended.`,
    }, { status: 409 })
  }

  const body = await req.json()
  const sources: SourceInput[] = Array.isArray(body.sources) ? body.sources : []
  if (sources.length === 0) return NextResponse.json({ error: 'INVALID_INPUT', messages: ['At least one source required'] }, { status: 400 })

  // De-dupe and parse, accumulating quantities for repeated (slip, lot) keys
  const sourceMap = new Map<string, { slipId: number; lotKey: string; lotNo: string; than: number; notes?: string | null }>()
  const errors: string[] = []
  for (const s of sources) {
    const slipId = parseInt(String(s.sourceDyeingEntryId))
    const lotNo = normalizeLotNo(s.originalLotNo) || String(s.originalLotNo || '').trim()
    const than = parseInt(String(s.than)) || 0
    if (!Number.isFinite(slipId) || slipId <= 0) { errors.push(`Invalid sourceDyeingEntryId: ${s.sourceDyeingEntryId}`); continue }
    if (!lotNo) { errors.push(`originalLotNo required (slip ${slipId})`); continue }
    if (than <= 0) { errors.push(`than must be > 0 (slip ${slipId}, lot ${lotNo})`); continue }
    const k = `${slipId}|${lotNo.toLowerCase()}`
    const cur = sourceMap.get(k)
    if (cur) { cur.than += than; if (s.notes && !cur.notes) cur.notes = s.notes }
    else sourceMap.set(k, { slipId, lotKey: lotNo.toLowerCase(), lotNo, than, notes: s.notes ?? null })
  }
  if (errors.length) return NextResponse.json({ error: 'INVALID_INPUT', messages: errors }, { status: 400 })

  const parsed = [...sourceMap.values()]
  const slipIds = [...new Set(parsed.map(p => p.slipId))]

  // Load slips with the shape the validator needs
  const slips = await db.dyeingEntry.findMany({
    where: { id: { in: slipIds } },
    select: {
      id: true, slipNo: true, isPcJob: true,
      lots: { select: { lotNo: true, than: true } },
      foldBatch: { select: { lots: { select: { lotNo: true, partyId: true, qualityId: true } } } },
    },
  })
  const slipById = new Map<number, any>()
  for (const s of slips) slipById.set(s.id, s)

  // Existing FEL and existing PC-RP source claims so we know remaining
  const finRows = await db.finishEntryLot.findMany({
    where: { dyeingEntryId: { in: slipIds } },
    select: { dyeingEntryId: true, lotNo: true, than: true },
  })
  const finBy = new Map<string, number>()
  for (const f of finRows) {
    const k = `${f.dyeingEntryId}|${f.lotNo.toLowerCase().trim()}`
    finBy.set(k, (finBy.get(k) || 0) + f.than)
  }
  const allReclaims = await db.pcPaliReprocessSource.findMany({
    where: { sourceDyeingEntryId: { in: slipIds } },
    select: { sourceDyeingEntryId: true, originalLotNo: true, than: true, pcReprocessId: true },
  })
  const reclaimBy = new Map<string, number>()
  for (const r of allReclaims) {
    const k = `${r.sourceDyeingEntryId}|${r.originalLotNo.toLowerCase().trim()}`
    reclaimBy.set(k, (reclaimBy.get(k) || 0) + r.than)
  }

  // Look up party/quality inheritance — only via foldBatch.lots; if missing
  // we fall back to grey/OB. Same approach as POST /pc-reprocess.
  const allLotNos = new Set<string>()
  for (const s of slips) {
    for (const fl of s.foldBatch?.lots || []) allLotNos.add(fl.lotNo)
  }
  const lotInGrey = await prisma.greyEntry.findMany({
    where: { lotNo: { in: [...allLotNos], mode: 'insensitive' } },
    select: { lotNo: true, partyId: true, qualityId: true },
  })
  const greyParty = new Map<string, number>()
  const greyQuality = new Map<string, number>()
  for (const g of lotInGrey) {
    const k = g.lotNo.toLowerCase().trim()
    if (!greyParty.has(k)) greyParty.set(k, g.partyId)
    if (!greyQuality.has(k)) greyQuality.set(k, g.qualityId)
  }
  const obRows = await db.lotOpeningBalance.findMany({
    where: { lotNo: { in: [...allLotNos], mode: 'insensitive' } },
    select: { lotNo: true, party: true, quality: true },
  })
  const obPartyNames = new Set<string>()
  const obQualityNames = new Set<string>()
  for (const o of obRows) {
    if (o.party) obPartyNames.add(o.party)
    if (o.quality) obQualityNames.add(o.quality)
  }
  const obParties = obPartyNames.size
    ? await prisma.party.findMany({ where: { name: { in: [...obPartyNames] } }, select: { id: true, name: true } })
    : []
  const obQualities = obQualityNames.size
    ? await prisma.quality.findMany({ where: { name: { in: [...obQualityNames] } }, select: { id: true, name: true } })
    : []
  const partyIdByName = new Map(obParties.map(p => [p.name, p.id]))
  const qualityIdByName = new Map(obQualities.map(q => [q.name, q.id]))
  for (const o of obRows) {
    const k = o.lotNo.toLowerCase().trim()
    if (!greyParty.has(k) && o.party) greyParty.set(k, partyIdByName.get(o.party) ?? 0)
    if (!greyQuality.has(k) && o.quality) greyQuality.set(k, qualityIdByName.get(o.quality) ?? 0)
  }

  // Validate each new source
  const newPartyIds = new Set<number>()
  const newQualityIds = new Set<number>()
  let addedThan = 0
  for (const ps of parsed) {
    const slip = slipById.get(ps.slipId)
    if (!slip) { errors.push(`Dye slip id ${ps.slipId} not found`); continue }
    if (!slip.isPcJob) { errors.push(`Slip ${slip.slipNo} is not a PC job`); continue }
    const slipLot = slip.lots.find((l: any) => l.lotNo.toLowerCase().trim() === ps.lotKey)
    if (!slipLot) { errors.push(`Lot ${ps.lotNo} not found in slip ${slip.slipNo}`); continue }
    const finishedThan = finBy.get(`${ps.slipId}|${ps.lotKey}`) || 0
    const reclaimedThan = reclaimBy.get(`${ps.slipId}|${ps.lotKey}`) || 0
    const available = slipLot.than - finishedThan - reclaimedThan
    if (ps.than > available) {
      errors.push(`Slip ${slip.slipNo}: requesting ${ps.than}T of ${ps.lotNo}, only ${available}T available (dyed ${slipLot.than}, finished ${finishedThan}, already reclaimed ${reclaimedThan})`)
      continue
    }
    addedThan += ps.than

    const fbLot = slip.foldBatch?.lots?.find((fl: any) => fl.lotNo.toLowerCase().trim() === ps.lotKey)
    const partyId = fbLot?.partyId ?? greyParty.get(ps.lotKey) ?? null
    const qualityId = fbLot?.qualityId ?? greyQuality.get(ps.lotKey) ?? null
    if (!partyId) { errors.push(`Cannot determine party for ${ps.lotNo} (slip ${slip.slipNo})`); continue }
    if (!qualityId) { errors.push(`Cannot determine quality for ${ps.lotNo} (slip ${slip.slipNo})`); continue }
    newPartyIds.add(partyId)
    newQualityIds.add(qualityId)
  }
  if (errors.length) return NextResponse.json({ error: 'INVALID_INPUT', messages: errors }, { status: 400 })

  // Decide new partyId / qualityId on the PC-RP after extension.
  // If the new sources match the existing single party/quality, keep it.
  // Otherwise demote to NULL ("mixed").
  let nextPartyId = existing.partyId
  if (nextPartyId != null) {
    if (newPartyIds.size > 1 || (newPartyIds.size === 1 && [...newPartyIds][0] !== nextPartyId)) {
      nextPartyId = null
    }
  }
  let nextQualityId = existing.qualityId
  if (nextQualityId != null) {
    if (newQualityIds.size > 1 || (newQualityIds.size === 1 && [...newQualityIds][0] !== nextQualityId)) {
      nextQualityId = null
    }
  }

  const updated = await prisma.$transaction(async (tx: any) => {
    await tx.pcPaliReprocessSource.createMany({
      data: parsed.map(ps => ({
        pcReprocessId: lotId,
        sourceDyeingEntryId: ps.slipId,
        originalLotNo: ps.lotNo,
        than: ps.than,
        reason: null,
        notes: ps.notes ?? null,
      })),
    })
    return tx.pcPaliReprocessLot.update({
      where: { id: lotId },
      data: {
        totalThan: existing.totalThan + addedThan,
        partyId: nextPartyId,
        qualityId: nextQualityId,
      },
      include: {
        sources: { orderBy: { id: 'asc' } },
        party: { select: { name: true } },
        quality: { select: { name: true } },
      },
    })
  })

  return NextResponse.json(updated, { status: 201 })
}
