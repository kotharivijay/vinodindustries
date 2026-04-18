export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET — list all re-process lots with sources
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lots = await db.reProcessLot.findMany({
    include: { sources: { orderBy: { id: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(lots)
}

// POST — create a new RE-PRO lot from source lots
// Body: { sources: [{ lotNo, than, party?, reason?, sourceDyeSlip? }], reason, notes? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sources, reason, notes } = await req.json()
  if (!Array.isArray(sources) || sources.length === 0) {
    return NextResponse.json({ error: 'At least one source lot required' }, { status: 400 })
  }
  if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })

  // Validate all sources have same quality
  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotNos = sources.map((s: any) => s.lotNo)
  const lotInfoMap = await buildLotInfoMap(lotNos)

  const qualities = new Set<string>()
  let totalWeight: string | null = null
  let totalMtr = 0
  let totalThan = 0

  for (const s of sources) {
    const info = lotInfoMap.get(s.lotNo.toLowerCase().trim())
    if (info?.quality) qualities.add(info.quality)
    if (info?.weight && !totalWeight) totalWeight = info.weight
    if (info?.mtrPerThan) totalMtr += info.mtrPerThan * (parseInt(s.than) || 0)
    totalThan += parseInt(s.than) || 0
  }

  if (qualities.size > 1) {
    return NextResponse.json({
      error: `Source lots have different qualities: ${Array.from(qualities).join(', ')}. All must be same quality.`,
    }, { status: 400 })
  }

  const quality = qualities.size === 1 ? Array.from(qualities)[0] : 'Unknown'

  // Generate next RE-PRO number
  const maxRepro = await db.reProcessLot.findFirst({ orderBy: { id: 'desc' }, select: { reproNo: true } })
  let nextNum = 1
  if (maxRepro?.reproNo) {
    const match = maxRepro.reproNo.match(/RE-PRO-(\d+)/)
    if (match) nextNum = parseInt(match[1]) + 1
  }
  const reproNo = `RE-PRO-${nextNum}`

  const lot = await db.reProcessLot.create({
    data: {
      reproNo,
      quality,
      weight: totalWeight,
      grayMtr: totalMtr > 0 ? totalMtr : null,
      totalThan,
      reason,
      notes: notes || null,
      sources: {
        create: sources.map((s: any) => ({
          originalLotNo: s.lotNo,
          than: parseInt(s.than) || 0,
          party: s.party || lotInfoMap.get(s.lotNo.toLowerCase().trim())?.party || null,
          reason: s.reason || reason,
          sourceDyeSlip: s.sourceDyeSlip ? parseInt(s.sourceDyeSlip) : null,
        })),
      },
    },
    include: { sources: true },
  })

  return NextResponse.json(lot, { status: 201 })
}

// PATCH — add more sources to existing RE-PRO lot or update status
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, addSources, status } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await db.reProcessLot.findUnique({ where: { id: parseInt(id) }, include: { sources: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Add more source lots
  if (addSources && Array.isArray(addSources) && addSources.length > 0) {
    const { buildLotInfoMap } = await import('@/lib/lot-info')
    const lotInfoMap = await buildLotInfoMap(addSources.map((s: any) => s.lotNo))

    let addedThan = 0
    let addedMtr = 0
    for (const s of addSources) {
      const info = lotInfoMap.get(s.lotNo.toLowerCase().trim())
      if (info?.quality && info.quality !== existing.quality) {
        return NextResponse.json({ error: `Quality mismatch: ${info.quality} vs ${existing.quality}` }, { status: 400 })
      }
      await db.reProcessSource.create({
        data: {
          reprocessId: existing.id,
          originalLotNo: s.lotNo,
          than: parseInt(s.than) || 0,
          party: s.party || info?.party || null,
          reason: s.reason || existing.reason,
          sourceDyeSlip: s.sourceDyeSlip ? parseInt(s.sourceDyeSlip) : null,
        },
      })
      addedThan += parseInt(s.than) || 0
      if (info?.mtrPerThan) addedMtr += info.mtrPerThan * (parseInt(s.than) || 0)
    }

    await db.reProcessLot.update({
      where: { id: existing.id },
      data: {
        totalThan: existing.totalThan + addedThan,
        grayMtr: (existing.grayMtr || 0) + addedMtr || null,
      },
    })
  }

  // Update status
  if (status) {
    const data: any = { status }
    if (status === 'merged') data.mergedAt = new Date()
    await db.reProcessLot.update({ where: { id: existing.id }, data })
  }

  const updated = await db.reProcessLot.findUnique({ where: { id: existing.id }, include: { sources: true } })
  return NextResponse.json(updated)
}

// DELETE — delete a RE-PRO lot (only if pending)
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  const lot = await db.reProcessLot.findUnique({ where: { id: parseInt(id) } })
  if (!lot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (lot.status !== 'pending') return NextResponse.json({ error: 'Can only delete pending RE-PRO lots' }, { status: 400 })

  await db.reProcessLot.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
