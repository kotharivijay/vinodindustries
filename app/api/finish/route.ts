export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

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
        slipNo: true,
        shadeName: true,
        lots: { select: { lotNo: true } },
        foldBatch: {
          select: {
            foldProgram: { select: { foldNo: true } },
            shade: { select: { name: true, description: true } },
          },
        },
      },
    }).catch(() => []),
  ])

  for (const de of dyeingEntries) {
    const foldNo = de.foldBatch?.foldProgram?.foldNo || null
    const shadeName = de.shadeName || de.foldBatch?.shade?.name || null
    const shadeDesc = de.foldBatch?.shade?.description || null
    const dLots = de.lots?.length ? de.lots.map((l: any) => l.lotNo) : []
    for (const ln of dLots) {
      if (!dyeingByLot.has(ln)) {
        dyeingByLot.set(ln, { slipNo: de.slipNo, shadeName, shadeDesc, foldNo })
      }
      if (!dyeingAllByLot.has(ln)) dyeingAllByLot.set(ln, [])
      dyeingAllByLot.get(ln)!.push({ slipNo: de.slipNo, shadeName, shadeDesc, foldNo })
    }
  }

  const enriched = entries.map((e: any) => {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than, doneThan: 0, status: 'pending' }]
    const partyNames = [...new Set(lots.map((l: any) => lotInfoMap.get(l.lotNo.toLowerCase().trim())?.party).filter(Boolean))]

    // Enrich each lot with party, quality, dyeing info
    const enrichedLots = lots.map((l: any) => {
      const info = lotInfoMap.get(l.lotNo.toLowerCase().trim())
      const dye = dyeingByLot.get(l.lotNo)
      const allDyes = dyeingAllByLot.get(l.lotNo) || []
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

    return { ...e, lots: enrichedLots, partyName: partyNames.join(', ') || null, fpStatus }
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
    ? data.marka.map((m: any) => ({ lotNo: String(m.lotNo).trim(), than: parseInt(m.than) || 0, meter: m.meter != null ? parseFloat(m.meter) : null }))
    : [{ lotNo: String(data.lotNo || '').trim(), than: parseInt(data.than) || 0, meter: data.meter != null ? parseFloat(data.meter) : null }]

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
