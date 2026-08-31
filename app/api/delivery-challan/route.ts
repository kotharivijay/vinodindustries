export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET — list all challans, newest first
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status')
  let rows = await db.finishDeliveryChallan.findMany({
    where: status ? { status } : undefined,
    include: {
      party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } },
      lines: { orderBy: { id: 'asc' }, include: { finishEntryLot: { select: { dyeingEntry: { select: { slipNo: true } } } } } },
    },
    orderBy: { challanNo: 'desc' },
  })

  // Self-heal transport snapshots across the whole list in one shot. Batches
  // one grey lookup per unique lot instead of per line — cheap on the happy
  // path (no lots need filling → no query). Same rule as the [id] GET.
  const missingLines: any[] = []
  for (const c of rows) for (const l of c.lines) if (!l.transportName && !l.transportLrNo) missingLines.push(l)
  if (missingLines.length) {
    const missingLots: string[] = Array.from(new Set(missingLines.map((l: any) => l.lotNo as string)))
    const greys = await db.greyEntry.findMany({
      where: { lotNo: { in: missingLots, mode: 'insensitive' } },
      select: {
        lotNo: true, transportLrNo: true, date: true, id: true,
        transport: { select: { name: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    })
    const winner = new Map<string, { name: string | null; lrNo: string | null }>()
    for (const g of greys as any[]) {
      const k = String(g.lotNo).toLowerCase().trim()
      if (!winner.has(k)) winner.set(k, { name: g.transport?.name ?? null, lrNo: g.transportLrNo ?? null })
    }
    const updates: any[] = []
    for (const l of missingLines) {
      const w = winner.get(String(l.lotNo).toLowerCase().trim())
      if (!w || (!w.name && !w.lrNo)) continue
      updates.push(db.finishDeliveryChallanLine.update({
        where: { id: l.id },
        data: { transportName: w.name, transportLrNo: w.lrNo },
      }))
    }
    if (updates.length) {
      await Promise.all(updates)
      rows = await db.finishDeliveryChallan.findMany({
        where: status ? { status } : undefined,
        include: {
          party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } },
          lines: { orderBy: { id: 'asc' } },
        },
        orderBy: { challanNo: 'desc' },
      })
    }
  }

  // Enrich each line with marka + source grey challan no (for the on-screen
  // detail table, print view and PDF). Neither is stored on the challan line,
  // so resolve from GreyEntry — one batched lookup over all lots.
  const allLots: string[] = Array.from(new Set(rows.flatMap((c: any) => c.lines.map((l: any) => l.lotNo as string))))
  if (allLots.length) {
    const gInfo = await db.greyEntry.findMany({
      where: { lotNo: { in: allLots, mode: 'insensitive' } },
      select: { lotNo: true, marka: true, challanNo: true },
      orderBy: { challanNo: 'asc' },
    })
    const byLot = new Map<string, { marka: string | null; chs: Set<number> }>()
    for (const g of gInfo as any[]) {
      const k = String(g.lotNo).toLowerCase().trim()
      if (!byLot.has(k)) byLot.set(k, { marka: null, chs: new Set() })
      const e = byLot.get(k)!
      if (g.marka && !e.marka) e.marka = g.marka
      if (g.challanNo != null) e.chs.add(g.challanNo)
    }
    for (const c of rows as any[]) for (const l of c.lines) {
      const info = byLot.get(String(l.lotNo).toLowerCase().trim())
      l.marka = info?.marka ?? null
      l.greyChallanNo = info && info.chs.size ? [...info.chs].join(', ') : null
      l.dyeSlipNo = l.finishEntryLot?.dyeingEntry?.slipNo ?? null
    }
  }

  return NextResponse.json(rows)
}

// POST — create one challan for one party using the selected FELs from the
// queue. Route splits are done client-side: if a queue selection spans two
// parties, the client sends two POSTs. Line snapshots are taken from the
// FinishEntryLot + its DyeingEntry to keep the printed challan stable.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const partyId = parseInt(String(body.partyId))
  const felIds: number[] = Array.isArray(body.finishEntryLotIds)
    ? body.finishEntryLotIds.map((x: any) => parseInt(String(x))).filter(Number.isFinite)
    : []
  // Grey returns are the second source that feeds this queue. A challan holds
  // ONE kind: finished goods and returned grey are different documents to the
  // party, and the DB CHECK on FinishDeliveryChallanLine enforces one source
  // per LINE anyway.
  const grLotIds: number[] = Array.isArray(body.greyReturnLotIds)
    ? body.greyReturnLotIds.map((x: any) => parseInt(String(x))).filter(Number.isFinite)
    : []
  // Challan is dated by its finish-program date (computed below from the FELs),
  // not the moment of creation. An explicit body.date still overrides.
  const explicitDate = body.date ? new Date(body.date) : null
  const transport = body.transport ? String(body.transport).trim() : null
  const lrNo = body.lrNo ? String(body.lrNo).trim() : null
  const notes = body.notes ? String(body.notes).trim() : null
  // Auto-inherit vehicle no + destination from the most recent challan so a
  // batch of challans in one trip doesn't need re-typing. Explicit body values
  // always win.
  const prevChallan = await db.finishDeliveryChallan.findFirst({
    orderBy: { challanNo: 'desc' },
    select: { vehicleNo: true, destination: true },
  })
  const vehicleNo = body.vehicleNo != null && String(body.vehicleNo).trim() ? String(body.vehicleNo).trim() : (prevChallan?.vehicleNo ?? null)
  const destination = body.destination != null && String(body.destination).trim() ? String(body.destination).trim() : (prevChallan?.destination ?? null)
  // Manual challan number override — bare positive integer. Any legacy
  // "DC-" prefix on input is tolerated but stripped.
  let manualChallanNo: number | null = null
  if (body.challanNo !== undefined && body.challanNo !== null && body.challanNo !== '') {
    const raw = String(body.challanNo).trim().replace(/^DC-?/i, '')
    const parsed = parseInt(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: 'INVALID_INPUT', messages: [`challanNo must be a positive integer`] }, { status: 400 })
    }
    manualChallanNo = parsed
  }

  const errors: string[] = []
  if (!Number.isFinite(partyId)) errors.push('partyId required')
  if (felIds.length === 0 && grLotIds.length === 0) errors.push('At least one finish-lot or grey-return lot required')
  if (errors.length) return NextResponse.json({ error: 'INVALID_INPUT', messages: errors }, { status: 400 })

  if (felIds.length > 0 && grLotIds.length > 0) {
    return NextResponse.json({
      error: 'MIXED_SOURCES',
      message: 'A challan cannot hold both finished goods and grey returns — create them separately.',
    }, { status: 400 })
  }
  const isGreyReturn = grLotIds.length > 0

  // Guard manual number early so we surface a clear error before touching FELs
  if (manualChallanNo != null) {
    const existing = await db.finishDeliveryChallan.findUnique({ where: { challanNo: manualChallanNo }, select: { id: true } })
    if (existing) {
      return NextResponse.json({
        error: 'DUPLICATE_CHALLAN_NO',
        message: `Challan ${manualChallanNo} already exists.`,
      }, { status: 409 })
    }
  }

  const party = await prisma.party.findUnique({ where: { id: partyId } })
  if (!party) return NextResponse.json({ error: 'PARTY_NOT_FOUND' }, { status: 404 })
  // The tag gate applies to FINISHED goods only: non-Pali parties send finished
  // cloth out on the legacy folding-despatch flow. Grey returns have no such
  // legacy path (and 235 of 260 parties are untagged), so they are exempt.
  if (!isGreyReturn && party.tag !== 'Pali PC Job') {
    return NextResponse.json({
      error: 'WRONG_PARTY_TAG',
      message: 'Delivery Challan is only for Pali PC Job parties. Other parties use the folding-despatch flow.',
    }, { status: 400 })
  }

  // Shared create: auto challan number (max + 1) with a single retry on unique
  // collision. Used by BOTH sources so the numbering can't drift apart.
  async function createChallanWithLines(date: Date, lineCreates: any[]) {
    const allChallans = await db.finishDeliveryChallan.findMany({ select: { challanNo: true } })
    let maxNo = 0
    for (const c of allChallans) maxNo = Math.max(maxNo, c.challanNo)
    const initialNo = manualChallanNo ?? (maxNo + 1)

    const buildData = (challanNo: number) => ({
      challanNo, date, partyId,
      format: 'delivery-challan',
      transport, lrNo, vehicleNo, destination, notes,
      status: 'issued' as const,
      // Seed the per-challan visibility from the party master's default. The
      // operator can flip this on the challan card without touching the party.
      showExtraCharges: !!(party as any).billExtraChargesDefault,
      lines: { create: lineCreates },
    })
    const include = { party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } }, lines: true }

    try {
      return await db.finishDeliveryChallan.create({ data: buildData(initialNo), include })
    } catch (e: any) {
      // Only retry auto-generated numbers. Manual overrides bubble the
      // duplicate error up so the operator picks a different number.
      if (String(e?.code) === 'P2002' && manualChallanNo == null) {
        const refreshed = await db.finishDeliveryChallan.findMany({ select: { challanNo: true } })
        let refreshedMax = 0
        for (const c of refreshed) refreshedMax = Math.max(refreshedMax, c.challanNo)
        return await db.finishDeliveryChallan.create({ data: buildData(refreshedMax + 1), include })
      }
      throw e
    }
  }

  // ── Grey-return challan ───────────────────────────────────────────────────
  // Self-contained: a grey-return lot carries its own party FK and snapshotted
  // quality/marka, so none of the FEL lotNo→grey party guesswork applies.
  if (isGreyReturn) {
    const grLots = await db.greyReturnLot.findMany({
      where: { id: { in: grLotIds } },
      include: { greyReturn: { select: { id: true, slipNo: true, date: true, partyId: true, status: true } } },
    })
    if (grLots.length !== grLotIds.length) {
      return NextResponse.json({ error: 'GREY_RETURN_LOT_NOT_FOUND', message: 'One or more grey-return lot ids do not exist.' }, { status: 400 })
    }
    const wrongParty = (grLots as any[]).filter((l: any) => l.greyReturn.partyId !== partyId)
    if (wrongParty.length) {
      return NextResponse.json({
        error: 'PARTY_MISMATCH',
        message: `Lot(s) ${wrongParty.map((l: any) => l.lotNo).join(', ')} do not belong to party ${party.name}.`,
      }, { status: 400 })
    }
    const cancelled = (grLots as any[]).filter((l: any) => l.greyReturn.status !== 'issued')
    if (cancelled.length) {
      return NextResponse.json({ error: 'GREY_RETURN_CANCELLED', message: 'One or more grey returns have been cancelled.' }, { status: 400 })
    }
    const already = await db.finishDeliveryChallanLine.findMany({
      where: { greyReturnLotId: { in: grLotIds } },
      select: { greyReturnLotId: true },
    })
    if (already.length > 0) {
      return NextResponse.json({
        error: 'ALREADY_ON_CHALLAN',
        message: `${already.length} grey-return lot(s) already shipped on another challan.`,
        greyReturnLotIds: already.map((l: any) => l.greyReturnLotId),
      }, { status: 409 })
    }

    // Dated by the latest source grey-return date, mirroring how a finished
    // challan is dated by its finish-program date.
    const grTimes = (grLots as any[]).map((l: any) => new Date(l.greyReturn.date).getTime())
    const grDate = explicitDate ?? (grTimes.length ? new Date(Math.max(...grTimes)) : new Date())

    const lineCreates = (grLots as any[]).map((l: any) => ({
      source: 'grey-return',
      greyReturnLotId: l.id,
      lotNo: l.lotNo,
      qualityName: l.qualityName ?? null,
      // Returned grey is undyed — no shade, and no shade category to group by.
      shadeName: null,
      shadeCategory: null,
      than: l.than,
      meter: l.meter ?? null,   // operator-entered despatch metres
      transportName: null,
      transportLrNo: null,
    }))

    try {
      const createdGr = await createChallanWithLines(grDate, lineCreates)
      return NextResponse.json(createdGr, { status: 201 })
    } catch (e: any) {
      if (String(e?.code) === 'P2002') {
        return NextResponse.json({
          error: 'DUPLICATE_CHALLAN_NO',
          message: `Challan ${manualChallanNo} was taken by another challan in a parallel request. Retry with a different number.`,
        }, { status: 409 })
      }
      throw e
    }
  }

  // Load FELs with their finish entry + dyeing shade info; validate all are
  // still unassigned, belong to this party, and are done/partial.
  const fels = await db.finishEntryLot.findMany({
    where: { id: { in: felIds } },
    include: {
      entry: { select: { id: true, slipNo: true, date: true } },
      dyeingEntry: {
        select: {
          shadeName: true,
          shadeDescription: true,
          foldBatch: { select: { shade: { select: { name: true, colorCategory: true } } } },
          additions: { select: { roundNo: true, resultShadeName: true, resultShadeDescription: true } },
        },
      },
    },
  })
  const { effectiveShade } = await import('@/lib/effective-shade')
  if (fels.length !== felIds.length) {
    return NextResponse.json({ error: 'FEL_NOT_FOUND', message: 'One or more finish-lot ids do not exist.' }, { status: 400 })
  }

  const alreadyLinked = await db.finishDeliveryChallanLine.findMany({
    where: { finishEntryLotId: { in: felIds } },
    select: { finishEntryLotId: true },
  })
  if (alreadyLinked.length > 0) {
    return NextResponse.json({
      error: 'ALREADY_ON_CHALLAN',
      message: `${alreadyLinked.length} finish-lot(s) already shipped on another challan.`,
      finishEntryLotIds: alreadyLinked.map((l: any) => l.finishEntryLotId),
    }, { status: 409 })
  }

  // Verify all FELs' party matches the requested partyId
  const lotNos: string[] = [...new Set((fels as any[]).map((f: any) => f.lotNo as string))]
  const greys = await db.greyEntry.findMany({
    where: { lotNo: { in: lotNos, mode: 'insensitive' }, partyId },
    select: {
      lotNo: true, transportLrNo: true, date: true, id: true,
      quality: { select: { name: true } },
      transport: { select: { name: true } },
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  })
  const qualityByLot = new Map<string, string | null>(
    (greys as any[]).map((g: any) => [g.lotNo.toLowerCase().trim(), g.quality?.name ?? null]),
  )
  // Snapshot transport + LR per lot (most recent grey row wins — orderBy
  // above sorts newest first, so the first entry we see is the one to keep).
  const transportByLot = new Map<string, { name: string | null; lrNo: string | null }>()
  for (const g of greys as any[]) {
    const key = g.lotNo.toLowerCase().trim()
    if (!transportByLot.has(key)) {
      transportByLot.set(key, { name: g.transport?.name ?? null, lrNo: g.transportLrNo ?? null })
    }
  }
  const missingLots: string[] = lotNos.filter((l: string) => !qualityByLot.has(l.toLowerCase().trim()))
  if (missingLots.length) {
    // Try OB as a fallback
    const obs = await db.lotOpeningBalance.findMany({
      where: { lotNo: { in: missingLots, mode: 'insensitive' }, party: party.name },
      select: { lotNo: true, quality: true },
    })
    for (const o of obs as any[]) qualityByLot.set(o.lotNo.toLowerCase().trim(), o.quality ?? null)
  }
  const stillMissing: string[] = lotNos.filter((l: string) => !qualityByLot.has(l.toLowerCase().trim()))
  if (stillMissing.length) {
    return NextResponse.json({
      error: 'PARTY_MISMATCH',
      message: `Lot(s) ${stillMissing.join(', ')} do not belong to party ${party.name}.`,
    }, { status: 400 })
  }

  // Date the challan by its finish-program date, not creation time. When the
  // selected FELs span multiple FPs, use the latest finish date. An explicit
  // body.date wins; fall back to now only if no FP date is available.
  const fpTimes = (fels as any[])
    .map((f: any) => f.entry?.date)
    .filter(Boolean)
    .map((d: any) => new Date(d).getTime())
  const date = explicitDate ?? (fpTimes.length ? new Date(Math.max(...fpTimes)) : new Date())

  const lineCreates = (fels as any[]).map((f: any) => {
    const key = f.lotNo.toLowerCase().trim()
    const tp = transportByLot.get(key)
    // Snapshot the effective shade — an addition round may have changed
    // the colour (e.g. K-cream → T-186), and the challan should carry the
    // final shade.
    const de = f.dyeingEntry
    const effF = de ? effectiveShade({ shadeName: de.shadeName || de.foldBatch?.shade?.name || null, shadeDescription: de.shadeDescription ?? null, additions: de.additions }) : null
    return {
      source: 'finish',
      finishEntryLotId: f.id,
      finishEntryId: f.entry.id,
      finishSlipNo: f.entry.slipNo,
      lotNo: f.lotNo,
      qualityName: qualityByLot.get(key) ?? null,
      shadeName: effF?.name ?? null,
      shadeCategory: effF?.changed ? null : (f.dyeingEntry?.foldBatch?.shade?.colorCategory || null),
      than: f.status === 'done' ? f.than : f.doneThan,
      meter: null, // PC Job challans don't carry meter
      transportName: tp?.name ?? null,
      transportLrNo: tp?.lrNo ?? null,
    }
  })

  let created: any
  try {
    created = await createChallanWithLines(date, lineCreates)
  } catch (e: any) {
    if (String(e?.code) === 'P2002') {
      return NextResponse.json({
        error: 'DUPLICATE_CHALLAN_NO',
        message: `Challan ${manualChallanNo} was taken by another challan in a parallel request. Retry with a different number.`,
      }, { status: 409 })
    }
    throw e
  }

  return NextResponse.json(created, { status: 201 })
}
