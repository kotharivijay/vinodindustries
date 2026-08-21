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
  const date = body.date ? new Date(body.date) : new Date()
  const transport = body.transport ? String(body.transport).trim() : null
  const lrNo = body.lrNo ? String(body.lrNo).trim() : null
  const vehicleNo = body.vehicleNo ? String(body.vehicleNo).trim() : null
  const notes = body.notes ? String(body.notes).trim() : null
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
  if (felIds.length === 0) errors.push('At least one finish-lot required')
  if (errors.length) return NextResponse.json({ error: 'INVALID_INPUT', messages: errors }, { status: 400 })

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
  if (party.tag !== 'Pali PC Job') {
    return NextResponse.json({
      error: 'WRONG_PARTY_TAG',
      message: 'Delivery Challan is only for Pali PC Job parties. Other parties use the folding-despatch flow.',
    }, { status: 400 })
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

  // Auto challan number: max + 1, retry once on unique collision. Manual
  // overrides skip the max lookup entirely.
  const allChallans = await db.finishDeliveryChallan.findMany({ select: { challanNo: true } })
  let maxNo = 0
  for (const c of allChallans) maxNo = Math.max(maxNo, c.challanNo)
  const initialNo = manualChallanNo ?? (maxNo + 1)

  const buildData = (challanNo: number) => ({
    challanNo,
    date,
    partyId,
    format: 'delivery-challan',
    transport,
    lrNo,
    vehicleNo,
    notes,
    status: 'issued' as const,
    // Seed the per-challan visibility from the party master's default. The
    // operator can flip this on the challan card without touching the party.
    showExtraCharges: !!(party as any).billExtraChargesDefault,
    lines: {
      create: fels.map((f: any) => {
        const key = f.lotNo.toLowerCase().trim()
        const tp = transportByLot.get(key)
        // Snapshot the effective shade — an addition round may have changed
        // the colour (e.g. K-cream → T-186), and the challan should carry the
        // final shade.
        const de = f.dyeingEntry
        const effF = de ? effectiveShade({ shadeName: de.shadeName || de.foldBatch?.shade?.name || null, shadeDescription: de.shadeDescription ?? null, additions: de.additions }) : null
        return {
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
      }),
    },
  })

  let created: any
  try {
    created = await db.finishDeliveryChallan.create({
      data: buildData(initialNo),
      include: { party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } }, lines: true },
    })
  } catch (e: any) {
    // Only retry auto-generated numbers. Manual overrides bubble the
    // duplicate error up so the operator picks a different number.
    if (String(e?.code) === 'P2002' && manualChallanNo == null) {
      const refreshed = await db.finishDeliveryChallan.findMany({ select: { challanNo: true } })
      let refreshedMax = 0
      for (const c of refreshed) refreshedMax = Math.max(refreshedMax, c.challanNo)
      created = await db.finishDeliveryChallan.create({
        data: buildData(refreshedMax + 1),
        include: { party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } }, lines: true },
      })
    } else if (String(e?.code) === 'P2002') {
      return NextResponse.json({
        error: 'DUPLICATE_CHALLAN_NO',
        message: `Challan ${manualChallanNo} was taken by another challan in a parallel request. Retry with a different number.`,
      }, { status: 409 })
    } else throw e
  }

  return NextResponse.json(created, { status: 201 })
}
