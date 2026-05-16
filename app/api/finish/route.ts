export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { allocateFpToDyeingSlips } from '@/lib/finish-slip-allocator'
import { normalizeLotNo } from '@/lib/lot-no'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let entries: any[]
  try {
    const db = prisma as any
    entries = await db.finishEntry.findMany({
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
        additions: { include: { chemicals: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { date: 'desc' },
    })
  } catch {
    return NextResponse.json([])
  }

  // Enrich with party/quality names
  const allLotNos = new Set<string>()
  for (const e of entries) {
    if (e.lots?.length) e.lots.forEach((l: any) => allLotNos.add(l.lotNo))
    else allLotNos.add(e.lotNo)
  }

  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotNosArr = Array.from(allLotNos)

  // Run lot info + dyeing queries in parallel
  const db2 = prisma as any
  let dyeingByLot = new Map<string, { slipNo: number; shadeName: string | null; shadeDesc: string | null; foldNo: string | null }>()
  let dyeingAllByLot = new Map<string, any[]>()

  const [lotInfoMap, dyeingEntries] = await Promise.all([
    buildLotInfoMap(lotNosArr),
    db2.dyeingEntry.findMany({
      where: {
        OR: [
          { lotNo: { in: lotNosArr } },
          { lots: { some: { lotNo: { in: lotNosArr } } } },
        ],
      },
      select: {
        id: true,
        slipNo: true,
        shadeName: true,
        lots: { select: { lotNo: true, than: true } },
        foldBatch: {
          select: {
            foldProgram: { select: { foldNo: true } },
            shade: { select: { name: true, description: true } },
          },
        },
      },
    }).catch(() => []),
  ])

  // Per-id index so an FEL row with dyeingEntryId can resolve its exact
  // source slip's meta (slipNo / shade / fold) without the lot-level
  // heuristic in dyeingByLot.
  const dyeingById = new Map<number, { slipNo: number; shadeName: string | null; shadeDesc: string | null; foldNo: string | null }>()
  for (const de of dyeingEntries) {
    const foldNo = de.foldBatch?.foldProgram?.foldNo || null
    const shadeName = de.shadeName || de.foldBatch?.shade?.name || null
    const shadeDesc = de.foldBatch?.shade?.description || null
    dyeingById.set(de.id, { slipNo: de.slipNo, shadeName, shadeDesc, foldNo })
  }

  // Index dyeing entries by lotNo so we can quickly pick the relevant subset
  // for each FP's allocator pass below.
  const dyeingByLotNo = new Map<string, any[]>()
  for (const de of dyeingEntries) {
    const foldNo = de.foldBatch?.foldProgram?.foldNo || null
    const shadeName = de.shadeName || de.foldBatch?.shade?.name || null
    const shadeDesc = de.foldBatch?.shade?.description || null
    const dLots = de.lots?.length ? de.lots : []
    for (const lot of dLots) {
      // Normalized key: DyeingEntryLot.lotNo casing can differ from
      // FinishEntryLot's — the lookups below use the same normalization.
      const ln = lot.lotNo.toLowerCase().trim()
      if (!dyeingByLot.has(ln)) {
        dyeingByLot.set(ln, { slipNo: de.slipNo, shadeName, shadeDesc, foldNo })
      }
      if (!dyeingAllByLot.has(ln)) dyeingAllByLot.set(ln, [])
      dyeingAllByLot.get(ln)!.push({ slipNo: de.slipNo, shadeName, shadeDesc, foldNo, dyedThan: lot.than || 0 })
      if (!dyeingByLotNo.has(ln)) dyeingByLotNo.set(ln, [])
      dyeingByLotNo.get(ln)!.push(de)
    }
  }

  const enriched = entries.map((e: any) => {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than, doneThan: 0, status: 'pending' }]
    const partyNames = [...new Set(lots.map((l: any) => lotInfoMap.get(l.lotNo.toLowerCase().trim())?.party).filter(Boolean))]

    // Enrich each lot with party, quality, dyeing info. When the FEL row
    // carries a dyeingEntryId, prefer that EXACT slip's meta over the
    // lot-level heuristic — so multiple FELs sharing a lotNo can each show
    // their own source slip (was the FP-177 / PS-57 ×4 display bug).
    const enrichedLots = lots.map((l: any) => {
      const lotKey = l.lotNo.toLowerCase().trim()
      const info = lotInfoMap.get(lotKey)
      const direct = l.dyeingEntryId != null ? dyeingById.get(l.dyeingEntryId) : null
      const dye = direct || dyeingByLot.get(lotKey)
      const allDyes = dyeingAllByLot.get(lotKey) || []
      return {
        ...l,
        party: info?.party || null,
        quality: info?.quality || null,
        mtrPerThan: info?.mtrPerThan || null,
        dyeSlipNo: dye?.slipNo || null,
        shadeName: dye?.shadeName || null,
        shadeDesc: dye?.shadeDesc || null,
        foldNo: dye?.foldNo || null,
        dyeSlips: allDyes,
      }
    })

    // FP status
    const allDone = enrichedLots.every((l: any) => l.status === 'done')
    const anyDone = enrichedLots.some((l: any) => l.status === 'done' || l.status === 'partial')
    const fpStatus = allDone ? 'finished' : anyDone ? 'partial' : 'pending'

    // Per-slip allocation: which dyeing slip contributed how much to THIS FP.
    // Same fit-by-than algorithm the print page uses, so the list-page card
    // expansion matches the printed slip exactly.
    const fpLotNoSet: Set<string> = new Set(lots.map((l: any) => String(l.lotNo).toLowerCase().trim()))
    const seenSlips = new Set<number>()
    const relevantDyeings: any[] = []
    for (const ln of fpLotNoSet) {
      const des = dyeingByLotNo.get(ln) || []
      for (const de of des) {
        if (seenSlips.has(de.slipNo)) continue
        seenSlips.add(de.slipNo)
        relevantDyeings.push(de)
      }
    }
    const allocations = allocateFpToDyeingSlips(
      lots.map((l: any) => ({ id: l.id, lotNo: l.lotNo, than: Number(l.than), dyeingEntryId: l.dyeingEntryId ?? null })),
      relevantDyeings.map((de: any) => ({
        id: de.id,
        slipNo: de.slipNo,
        shadeName: de.shadeName ?? null,
        lots: de.lots,
        foldBatch: de.foldBatch ?? null,
      })),
    )

    return { ...e, lots: enrichedLots, partyName: partyNames.join(', ') || null, fpStatus, allocations }
  })

  return NextResponse.json(enriched)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  if (!data.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = prisma as any
  try {
    await db.finishEntry.delete({ where: { id: parseInt(data.id) } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to delete' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  if (!data.date || !data.slipNo) {
    return NextResponse.json({ error: 'Date and Slip No are required.' }, { status: 400 })
  }

  const lots = data.marka?.length
    ? data.marka.map((m: any) => ({
        lotNo: normalizeLotNo(m.lotNo) ?? '',
        than: parseInt(m.than) || 0,
        meter: m.meter != null ? parseFloat(m.meter) : null,
        // dyeingEntryId — when the client picked specific dye slips for this
        // finish (slip-wise view), record the source so the stock route can
        // deduct exactly instead of falling back to the FIFO heuristic.
        dyeingEntryId: m.dyeingEntryId != null ? parseInt(m.dyeingEntryId) || null : null,
      }))
    : [{ lotNo: normalizeLotNo(data.lotNo) ?? '', than: parseInt(data.than) || 0, meter: data.meter != null ? parseFloat(data.meter) : null, dyeingEntryId: null }]

  const chemData = data.chemicals?.length
    ? data.chemicals.map((c: any) => ({
        chemicalId: c.chemicalId ?? null,
        name: c.name,
        quantity: c.quantity != null ? parseFloat(c.quantity) : null,
        unit: c.unit || 'kg',
        rate: c.rate != null ? parseFloat(c.rate) : null,
        cost: c.cost != null ? parseFloat(c.cost) : null,
      }))
    : []

  const db = prisma as any
  try {
    const entry = await db.finishEntry.create({
      data: {
        date: new Date(data.date),
        slipNo: parseInt(data.slipNo),
        lotNo: lots[0].lotNo,
        than: lots[0].than,
        meter: data.totalMeter != null ? parseFloat(data.totalMeter) : null,
        mandi: data.mandi != null ? parseFloat(data.mandi) : null,
        notes: data.notes || null,
        chemicals: chemData.length ? { create: chemData } : undefined,
        lots: { create: lots },
      },
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
      },
    })

    // Learn aliases: save OCR name -> master chemical mapping
    if (data.chemicals?.length && data.ocrNames?.length) {
      try {
        const aliasOps = []
        for (let i = 0; i < data.chemicals.length; i++) {
          const chem = data.chemicals[i]
          const ocrRaw = data.ocrNames[i]
          if (!ocrRaw || !chem.chemicalId) continue
          const ocrNorm = ocrRaw.toLowerCase().trim().replace(/\s+/g, ' ')
          const finalNorm = chem.name.toLowerCase().trim().replace(/\s+/g, ' ')
          if (ocrNorm && ocrNorm !== finalNorm) {
            aliasOps.push(
              db.chemicalAlias.upsert({
                where: { ocrName: ocrNorm },
                create: { ocrName: ocrNorm, chemicalId: chem.chemicalId },
                update: { chemicalId: chem.chemicalId, hitCount: { increment: 1 } },
              })
            )
          }
        }
        if (aliasOps.length) await Promise.all(aliasOps)
      } catch {
        // ChemicalAlias table may not exist yet -- skip
      }
    }

    return NextResponse.json(entry, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to save' }, { status: 500 })
  }
}
