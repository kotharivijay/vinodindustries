export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET /api/fold/pc/lot-weights?foldId=45
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const foldId = req.nextUrl.searchParams.get('foldId')
  if (!foldId) return NextResponse.json({ error: 'foldId required' }, { status: 400 })

  try {
    const program = await db.foldProgram.findUnique({
      where: { id: parseInt(foldId), isPcJob: true },
      include: {
        batches: {
          include: {
            shade: true,
            lots: { include: { party: true, quality: true } },
          },
          orderBy: { batchNo: 'asc' },
        },
      },
    })

    if (!program) return NextResponse.json({ error: 'Fold program not found' }, { status: 404 })

    // Collect all unique lot numbers
    const allLotNos = new Set<string>()
    for (const batch of program.batches) {
      for (const lot of batch.lots) {
        allLotNos.add(lot.lotNo)
      }
    }

    // Fetch grey entries for all lots at once
    const greyEntries = await db.greyEntry.findMany({
      where: { lotNo: { in: Array.from(allLotNos) } },
      select: { lotNo: true, weight: true, grayMtr: true, than: true },
    })

    // Build a map: lotNo -> { weight, grayMtr, than }
    // A lot may have multiple grey entries; aggregate than, take first weight/grayMtr
    const greyMap = new Map<string, { weight: string | null; grayMtr: number | null; than: number }>()
    for (const ge of greyEntries) {
      const existing = greyMap.get(ge.lotNo)
      if (existing) {
        existing.than += ge.than
        if (!existing.weight && ge.weight) existing.weight = ge.weight
        if (existing.grayMtr == null && ge.grayMtr != null) existing.grayMtr = ge.grayMtr
      } else {
        greyMap.set(ge.lotNo, { weight: ge.weight, grayMtr: ge.grayMtr, than: ge.than })
      }
    }

    const batches = program.batches.map((batch: any) => {
      const markaList = (batch.marka ?? '').split(',').filter(Boolean)
      const shadeName = batch.shade?.name ?? batch.shadeName ?? ''
      return {
        batchNo: batch.batchNo,
        marka: markaList.join(', '),
        shade: shadeName,
        lots: batch.lots.map((lot: any) => {
          const grey = greyMap.get(lot.lotNo)
          return {
            lotNo: lot.lotNo,
            than: lot.than,
            weight: grey?.weight ?? null,
            grayMtr: grey?.grayMtr ?? null,
          }
        }),
      }
    })

    return NextResponse.json({ batches })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/fold/pc/lot-weights
// Body: { lots: [{ lotNo, weight, avgCut }] }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { lots } = body

    if (!Array.isArray(lots) || lots.length === 0) {
      return NextResponse.json({ error: 'lots array required' }, { status: 400 })
    }

    let updated = 0

    for (const lot of lots) {
      const { lotNo, weight, avgCut } = lot
      if (!lotNo) continue

      // Find grey entries for this lot
      const entries = await db.greyEntry.findMany({
        where: { lotNo },
        select: { id: true, than: true },
      })

      if (entries.length === 0) continue

      // Build update data
      const updateData: any = {}
      if (weight !== undefined && weight !== null && weight !== '') {
        updateData.weight = String(weight)
      }
      if (avgCut !== undefined && avgCut !== null && avgCut !== '') {
        // Compute grayMtr for each entry based on its own than
        // Update each entry individually when avgCut is provided
        for (const entry of entries) {
          const entryUpdate: any = { ...updateData }
          entryUpdate.grayMtr = parseFloat(String(avgCut)) * entry.than
          await db.greyEntry.update({
            where: { id: entry.id },
            data: entryUpdate,
          })
        }
        updated++
        continue
      }

      // No avgCut — just update weight on all entries for this lot
      if (Object.keys(updateData).length > 0) {
        await db.greyEntry.updateMany({
          where: { lotNo },
          data: updateData,
        })
        updated++
      }
    }

    return NextResponse.json({ ok: true, updated })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
