export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

const db = prisma as any

const VALID_REASONS = new Set(['patchy', 'daagi', 'shade_mismatch', 'customer_reject', 'other'])

type SourceInput = {
  sourceDyeingEntryId: number | string
  originalLotNo: string
  than: number | string
  notes?: string | null
}

// GET — list PC Pali reprocess lots with sources, newest first
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lots = await db.pcPaliReprocessLot.findMany({
    include: {
      sources: { orderBy: { id: 'asc' } },
      party: { select: { name: true } },
      quality: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(lots)
}

// POST — create a PC Pali rework lot from one or more bad PC dye slips
// Body: {
//   reason, notes?,
//   sources: [{ sourceDyeingEntryId, originalLotNo, than, notes? }]
// }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { reason, notes } = body
  const sources: SourceInput[] = Array.isArray(body.sources) ? body.sources : []

  const errors: string[] = []
  if (!reason || !VALID_REASONS.has(reason)) {
    errors.push(`reason must be one of: ${[...VALID_REASONS].join(', ')}`)
  }
  if (sources.length === 0) errors.push('At least one source required')
  if (errors.length) return NextResponse.json({ error: 'INVALID_INPUT', messages: errors }, { status: 400 })

  // Parse and de-dupe source keys early (combine duplicate (slip, lot) rows)
  const sourceMap = new Map<string, { slipId: number; lotKey: string; lotNo: string; than: number; notes?: string | null }>()
  for (const s of sources) {
    const slipId = parseInt(String(s.sourceDyeingEntryId))
    const lotNo = normalizeLotNo(s.originalLotNo) || String(s.originalLotNo || '').trim()
    const than = parseInt(String(s.than)) || 0
    if (!Number.isFinite(slipId) || slipId <= 0) {
      errors.push(`Invalid sourceDyeingEntryId: ${s.sourceDyeingEntryId}`)
      continue
    }
    if (!lotNo) {
      errors.push(`originalLotNo required (slip ${slipId})`)
      continue
    }
    if (than <= 0) {
      errors.push(`than must be > 0 (slip ${slipId}, lot ${lotNo})`)
      continue
    }
    const k = `${slipId}|${lotNo.toLowerCase()}`
    const existing = sourceMap.get(k)
    if (existing) {
      existing.than += than
      if (s.notes && !existing.notes) existing.notes = s.notes
    } else {
      sourceMap.set(k, { slipId, lotKey: lotNo.toLowerCase(), lotNo, than, notes: s.notes ?? null })
    }
  }
  if (errors.length) return NextResponse.json({ error: 'INVALID_INPUT', messages: errors }, { status: 400 })

  const parsedSources = [...sourceMap.values()]
  const slipIds = [...new Set(parsedSources.map(s => s.slipId))]

  // Load all referenced dye slips with lots, and their grey/OB inheritance hints
  const slips = await db.dyeingEntry.findMany({
    where: { id: { in: slipIds } },
    select: {
      id: true,
      slipNo: true,
      isPcJob: true,
      shadeName: true,
      lots: { select: { lotNo: true, than: true } },
      foldBatch: {
        select: {
          marka: true,
          lots: { select: { lotNo: true, partyId: true, qualityId: true } },
        },
      },
    },
  })
  const slipById = new Map<number, any>()
  for (const s of slips) slipById.set(s.id, s)

  // Existing finish-than per (slipId, lotKey) — finished elsewhere portion
  const finishedByDyeLot = new Map<string, number>()
  const finRows = await db.finishEntryLot.findMany({
    where: { dyeingEntryId: { in: slipIds } },
    select: { dyeingEntryId: true, lotNo: true, than: true },
  })
  for (const f of finRows) {
    const k = `${f.dyeingEntryId}|${f.lotNo.toLowerCase().trim()}`
    finishedByDyeLot.set(k, (finishedByDyeLot.get(k) || 0) + f.than)
  }

  // Existing PC-RP reclaimed-than per (slipId, lotKey) — already reclaimed portion
  const reclaimedByDyeLot = new Map<string, number>()
  const existingPcRpSources = await db.pcPaliReprocessSource.findMany({
    where: { sourceDyeingEntryId: { in: slipIds } },
    select: { sourceDyeingEntryId: true, originalLotNo: true, than: true },
  })
  for (const r of existingPcRpSources) {
    const k = `${r.sourceDyeingEntryId}|${r.originalLotNo.toLowerCase().trim()}`
    reclaimedByDyeLot.set(k, (reclaimedByDyeLot.get(k) || 0) + r.than)
  }

  // Collect lotNos used so we can resolve party/quality (via FoldBatchLot if present)
  const allLotNos = new Set<string>()
  for (const s of slips) {
    for (const fl of s.foldBatch?.lots || []) allLotNos.add(fl.lotNo)
    for (const l of s.lots) allLotNos.add(l.lotNo)
  }
  // Party/quality inheritance for non-fold-derived sources: query GreyEntry +
  // LotOpeningBalance keyed by lotNo (case-insensitive).
  const lotNosArr = [...allLotNos]
  const lotNoIn = { in: lotNosArr, mode: 'insensitive' as const }
  const [greyForLot, obForLot] = await Promise.all([
    prisma.greyEntry.findMany({
      where: { lotNo: lotNoIn },
      select: { lotNo: true, partyId: true, qualityId: true, weight: true, marka: true, grayMtr: true },
    }),
    db.lotOpeningBalance.findMany({
      where: { lotNo: lotNoIn },
      select: { lotNo: true, party: true, quality: true, weight: true, marka: true, grayMtr: true },
    }),
  ])
  const partyByLot = new Map<string, number | null>()
  const qualityByLot = new Map<string, number | null>()
  const weightByLot = new Map<string, string | null>()
  const markaByLot = new Map<string, string | null>()
  const mtrByLot = new Map<string, number | null>()
  for (const g of greyForLot) {
    const k = g.lotNo.toLowerCase().trim()
    if (!partyByLot.has(k)) partyByLot.set(k, g.partyId)
    if (!qualityByLot.has(k)) qualityByLot.set(k, g.qualityId)
    if (!weightByLot.has(k)) weightByLot.set(k, g.weight)
    if (!markaByLot.has(k) && g.marka) markaByLot.set(k, g.marka)
    if (!mtrByLot.has(k)) mtrByLot.set(k, g.grayMtr)
  }
  // OB rows carry party/quality as NAMES not ids — need name→id lookup for those
  const obPartyNames = new Set<string>()
  const obQualityNames = new Set<string>()
  for (const o of obForLot) {
    if (o.party) obPartyNames.add(o.party)
    if (o.quality) obQualityNames.add(o.quality)
  }
  const obParties = obPartyNames.size
    ? await prisma.party.findMany({ where: { name: { in: [...obPartyNames] } }, select: { id: true, name: true } })
    : []
  const obQualities = obQualityNames.size
    ? await prisma.quality.findMany({ where: { name: { in: [...obQualityNames] } }, select: { id: true, name: true } })
    : []
  const partyNameToId = new Map(obParties.map(p => [p.name, p.id]))
  const qualityNameToId = new Map(obQualities.map(q => [q.name, q.id]))
  for (const o of obForLot) {
    const k = o.lotNo.toLowerCase().trim()
    if (!partyByLot.has(k) && o.party) partyByLot.set(k, partyNameToId.get(o.party) ?? null)
    if (!qualityByLot.has(k) && o.quality) qualityByLot.set(k, qualityNameToId.get(o.quality) ?? null)
    if (!weightByLot.has(k) && o.weight) weightByLot.set(k, o.weight)
    if (!markaByLot.has(k) && o.marka) markaByLot.set(k, o.marka)
    if (!mtrByLot.has(k) && o.grayMtr) mtrByLot.set(k, o.grayMtr)
  }

  // Now validate each parsed source row
  const inheritedPartyIds = new Set<number>()
  const inheritedQualityIds = new Set<number>()
  const inheritedWeights = new Set<string>()
  const inheritedMarkas = new Set<string>()
  let totalThan = 0
  let totalMtr = 0

  for (const ps of parsedSources) {
    const slip = slipById.get(ps.slipId)
    if (!slip) {
      errors.push(`Dye slip id ${ps.slipId} not found`)
      continue
    }
    if (!slip.isPcJob) {
      errors.push(`Slip ${slip.slipNo} is not a PC job — use the regular reprocess flow`)
      continue
    }
    const slipLot = slip.lots.find((l: any) => l.lotNo.toLowerCase().trim() === ps.lotKey)
    if (!slipLot) {
      errors.push(`Lot ${ps.lotNo} not found in dye slip ${slip.slipNo}`)
      continue
    }
    const finishedHere = finishedByDyeLot.get(`${ps.slipId}|${ps.lotKey}`) || 0
    const reclaimedHere = reclaimedByDyeLot.get(`${ps.slipId}|${ps.lotKey}`) || 0
    const stillAvailable = slipLot.than - finishedHere - reclaimedHere
    if (ps.than > stillAvailable) {
      errors.push(
        `Slip ${slip.slipNo}: requesting ${ps.than}T of ${ps.lotNo}, ` +
        `only ${stillAvailable}T available (dyed ${slipLot.than}, ` +
        `already finished ${finishedHere}, already reclaimed ${reclaimedHere})`,
      )
      continue
    }
    totalThan += ps.than

    // Inherit party/quality. Try foldBatch.lots first (most precise), then fall back to greyForLot/obForLot.
    const fbLot = slip.foldBatch?.lots?.find((fl: any) => fl.lotNo.toLowerCase().trim() === ps.lotKey)
    const partyId = fbLot?.partyId ?? partyByLot.get(ps.lotKey) ?? null
    const qualityId = fbLot?.qualityId ?? qualityByLot.get(ps.lotKey) ?? null
    if (!partyId) {
      errors.push(`Cannot determine party for ${ps.lotNo} (slip ${slip.slipNo})`)
      continue
    }
    if (!qualityId) {
      errors.push(`Cannot determine quality for ${ps.lotNo} (slip ${slip.slipNo})`)
      continue
    }
    inheritedPartyIds.add(partyId)
    inheritedQualityIds.add(qualityId)

    const w = weightByLot.get(ps.lotKey)
    if (w) inheritedWeights.add(w)
    const mk = markaByLot.get(ps.lotKey)
    if (mk) inheritedMarkas.add(mk)
    const slipMarka = slip.foldBatch?.marka
    if (slipMarka) inheritedMarkas.add(slipMarka)

    const m = mtrByLot.get(ps.lotKey)
    if (m && slipLot.than > 0) totalMtr += (m / (slipLot.than || 1)) * ps.than
  }

  if (errors.length) return NextResponse.json({ error: 'INVALID_INPUT', messages: errors }, { status: 400 })

  // Mixed party / quality is allowed. When sources disagree, store null on
  // the PC-RP top level — the per-source rows still carry their own origin
  // via originalLotNo, so cost attribution and lot history stay accurate.
  const partyId = inheritedPartyIds.size === 1 ? [...inheritedPartyIds][0] : null
  const qualityId = inheritedQualityIds.size === 1 ? [...inheritedQualityIds][0] : null
  const inheritedShade = slips.find((s: any) => s.shadeName)?.shadeName || null
  const weight = inheritedWeights.size === 1 ? [...inheritedWeights][0] : (inheritedWeights.size > 1 ? [...inheritedWeights].join(', ') : null)
  const marka = inheritedMarkas.size ? [...inheritedMarkas].join(', ') : null
  const grayMtr = totalMtr > 0 ? Math.round(totalMtr * 100) / 100 : null

  // Atomic-ish reproNo: scan max + 1. Collisions caught by @unique → retry once.
  const allRepro = await db.pcPaliReprocessLot.findMany({ select: { reproNo: true } })
  let maxNum = 0
  for (const r of allRepro) {
    const m = String(r.reproNo).match(/^PC-RP-(\d+)$/)
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]))
  }

  const create = async (n: number) => {
    const reproNo = `PC-RP-${n}`
    return db.pcPaliReprocessLot.create({
      data: {
        reproNo,
        partyId,
        qualityId,
        shadeName: inheritedShade,
        weight,
        marka,
        grayMtr,
        totalThan,
        reason,
        notes: notes || null,
        status: 'pending-approval',
        sources: {
          create: parsedSources.map(ps => ({
            sourceDyeingEntryId: ps.slipId,
            originalLotNo: ps.lotNo,
            than: ps.than,
            reason: null,
            notes: ps.notes ?? null,
          })),
        },
      },
      include: {
        sources: true,
        party: { select: { name: true } },
        quality: { select: { name: true } },
      },
    })
  }

  let created: any
  try {
    created = await create(maxNum + 1)
  } catch (e: any) {
    // Retry once if a parallel POST grabbed the same number
    if (String(e?.code) === 'P2002') {
      const refreshed = await db.pcPaliReprocessLot.findMany({ select: { reproNo: true } })
      let refreshedMax = 0
      for (const r of refreshed) {
        const m = String(r.reproNo).match(/^PC-RP-(\d+)$/)
        if (m) refreshedMax = Math.max(refreshedMax, parseInt(m[1]))
      }
      created = await create(refreshedMax + 1)
    } else throw e
  }

  return NextResponse.json(created, { status: 201 })
}
