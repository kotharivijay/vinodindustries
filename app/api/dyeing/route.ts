export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Quick endpoint to get max slip number
  if (req.nextUrl.searchParams.get('maxSlipNo') === 'true') {
    const db = prisma as any
    const result = await db.dyeingEntry.aggregate({ _max: { slipNo: true } })
    return NextResponse.json({ maxSlipNo: result._max?.slipNo ?? 0 })
  }

  let entries: any[]
  try {
    const db = prisma as any
    entries = await db.dyeingEntry.findMany({
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
        machine: true,
        operator: true,
        foldBatch: {
          include: {
            foldProgram: { select: { foldNo: true } },
            shade: { select: { name: true } },
          },
        },
        additions: {
          include: { chemicals: true, machine: true, operator: true },
          orderBy: { roundNo: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
    })
  } catch {
    // Fallback if lots table doesn't exist yet
    entries = (await prisma.dyeingEntry.findMany({
      include: { chemicals: { include: { chemical: true } } },
      orderBy: { date: 'desc' },
    })).map(e => ({ ...e, lots: [] }))
  }

  // Enrich with party names from grey entries + carry-forward fallback
  const allLotNos = new Set<string>()
  for (const e of entries) {
    if (e.lots?.length) e.lots.forEach((l: any) => allLotNos.add(l.lotNo))
    else allLotNos.add(e.lotNo)
  }

  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotInfoMap = await buildLotInfoMap(Array.from(allLotNos))

  const enriched = entries.map((e: any) => {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
    const lotInfos = lots.map((l: any) => lotInfoMap.get(l.lotNo.toLowerCase().trim())).filter(Boolean)
    const partyNames = [...new Set(lotInfos.map((li: any) => li.party).filter(Boolean))]
    const lotMarka = lotInfos.find((li: any) => li.marka)?.marka || null
    return { ...e, partyName: partyNames.join(', ') || null, marka: e.marka || lotMarka }
  })

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  if (!data.date || !data.slipNo || !data.lotNo || !data.than) {
    return NextResponse.json({ error: 'Date, Slip No, Lot No and Than are required.' }, { status: 400 })
  }

  // Build lots array from marka or single lot
  const lots = data.marka?.length
    ? data.marka.map((m: any) => ({ lotNo: normalizeLotNo(m.lotNo) ?? '', than: parseInt(m.than) || 0 }))
    : [{ lotNo: normalizeLotNo(data.lotNo) ?? '', than: parseInt(data.than) }]

  const chemData = data.chemicals?.length
    ? data.chemicals.map((c: any) => ({
        chemicalId: c.chemicalId ?? null,
        name: c.name,
        quantity: c.quantity != null ? parseFloat(c.quantity) : null,
        unit: c.unit || 'kg',
        rate: c.rate != null ? parseFloat(c.rate) : null,
        cost: c.cost != null ? parseFloat(c.cost) : null,
        processTag: c.processTag || null,
      }))
    : []

  const db = prisma as any

  // Create ONE entry per slip. Use first lot for backward compat fields.
  const entry = await db.dyeingEntry.create({
    data: {
      date: new Date(data.date),
      slipNo: parseInt(data.slipNo),
      lotNo: lots[0].lotNo,
      than: lots[0].than,
      shadeName: data.shadeName?.trim() || null,
      shadeDescription: data.shadeDescription?.trim() || null,
      notes: data.notes || null,
      machineId: data.machineId ? parseInt(data.machineId) : null,
      operatorId: data.operatorId ? parseInt(data.operatorId) : null,
      chemicals: chemData.length ? { create: chemData } : undefined,
      lots: { create: lots },
    },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
    },
  })

  // ── Learn aliases: save OCR name → master chemical mapping ──
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
      // ChemicalAlias table may not exist yet — skip
    }
  }

  return NextResponse.json(entry, { status: 201 })
}
