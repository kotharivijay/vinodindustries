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

  const { sources, reason, notes, acceptMixedQuality, confirmedWeight, confirmedQuality, confirmed } = await req.json()
  if (!Array.isArray(sources) || sources.length === 0) {
    return NextResponse.json({ error: 'At least one source lot required' }, { status: 400 })
  }
  if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })

  // Resolve quality info for every source lot
  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotNos = sources.map((s: any) => s.lotNo)
  const lotInfoMap = await buildLotInfoMap(lotNos)

  const sourceQualities: { lotNo: string; quality: string | null }[] = sources.map((s: any) => ({
    lotNo: s.lotNo,
    quality: lotInfoMap.get(s.lotNo.toLowerCase().trim())?.quality || null,
  }))
  const qualities = new Set<string>()
  for (const sq of sourceQualities) if (sq.quality) qualities.add(sq.quality)

  // If multiple qualities and user hasn't confirmed yet, ask the client to
  // get explicit approval (or to drop the conflicting lots and retry).
  if (qualities.size > 1 && !acceptMixedQuality) {
    return NextResponse.json({
      needsConfirm: true,
      reason: 'MIXED_QUALITY',
      message: `Source lots have ${qualities.size} different qualities.`,
      qualities: Array.from(qualities),
      lots: sourceQualities,
    }, { status: 200 })
  }

  // Aggregate meter + than, and compute a than-weighted average weight
  // (weights look like "110g", "98g" — strip non-digits, average, format).
  let totalMtr = 0
  let totalThan = 0
  let weightSum = 0     // sum of (numeric weight × than)
  let weightThan = 0    // total than for which a weight was available
  let weightSuffix = ''
  for (const s of sources) {
    const info = lotInfoMap.get(s.lotNo.toLowerCase().trim())
    const than = parseInt(s.than) || 0
    if (info?.mtrPerThan) totalMtr += info.mtrPerThan * than
    totalThan += than
    if (info?.weight) {
      const m = String(info.weight).match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]*)/)
      if (m) {
        const num = parseFloat(m[1])
        if (Number.isFinite(num) && than > 0) {
          weightSum += num * than
          weightThan += than
          if (!weightSuffix && m[2]) weightSuffix = m[2]
        }
      }
    }
  }
  const totalWeight: string | null = weightThan > 0
    ? `${Math.round(weightSum / weightThan)}${weightSuffix || 'g'}`
    : null

  // Pick a representative quality. If user accepted mixed, use the most
  // common one; otherwise the single value.
  let computedQuality: string | null = null
  if (qualities.size === 1) computedQuality = Array.from(qualities)[0]
  else if (qualities.size > 1) {
    const counts = new Map<string, number>()
    for (const sq of sourceQualities) if (sq.quality) counts.set(sq.quality, (counts.get(sq.quality) || 0) + 1)
    computedQuality = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  // Ask client to confirm weight + quality before saving. Also surface a
  // dropdown list of all qualities so user can pick when none is detected
  // (computedQuality === null).
  if (!confirmed) {
    const allQualities = await prisma.quality.findMany({ select: { name: true }, orderBy: { name: 'asc' } })
    return NextResponse.json({
      needsConfirm: true,
      reason: 'CONFIRM_WEIGHT_QUALITY',
      computedWeight: totalWeight,
      computedQuality,
      computedThan: totalThan,
      computedMtr: totalMtr > 0 ? totalMtr : null,
      qualityOptions: allQualities.map(q => q.name),
      message: computedQuality
        ? `Confirm weight ${totalWeight ?? '—'} and quality ${computedQuality}.`
        : `No quality detected on source lots — please pick one.`,
    }, { status: 200 })
  }

  const quality = (confirmedQuality && String(confirmedQuality).trim()) || computedQuality || 'Unknown'
  const finalWeight: string | null = (confirmedWeight !== undefined ? (String(confirmedWeight).trim() || null) : totalWeight)

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
      weight: finalWeight,
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

  const { id, addSources, updateSources, removeSources, reason, notes, grayMtr, status, acceptMixedQuality } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await db.reProcessLot.findUnique({ where: { id: parseInt(id) }, include: { sources: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Edit existing source rows (lotNo / than / party / reason / notes).
  // Only fields actually provided in the payload are touched.
  if (Array.isArray(updateSources) && updateSources.length > 0) {
    for (const u of updateSources) {
      if (!u?.id) continue
      const data: any = {}
      if (u.than !== undefined) data.than = parseInt(u.than) || 0
      if (u.party !== undefined) data.party = u.party || null
      if (u.reason !== undefined) data.reason = u.reason || existing.reason
      if (u.notes !== undefined) data.notes = u.notes || null
      if (u.originalLotNo !== undefined) {
        const v = String(u.originalLotNo).trim()
        if (v) data.originalLotNo = v
      }
      if (Object.keys(data).length === 0) continue
      await db.reProcessSource.update({ where: { id: parseInt(u.id) }, data })
    }
  }

  // Remove source rows
  if (Array.isArray(removeSources) && removeSources.length > 0) {
    await db.reProcessSource.deleteMany({ where: { id: { in: removeSources.map((x: any) => parseInt(x)) }, reprocessId: existing.id } })
  }

  // Top-level fields
  if (reason !== undefined || notes !== undefined || grayMtr !== undefined) {
    const data: any = {}
    if (reason !== undefined) data.reason = reason
    if (notes !== undefined) data.notes = notes || null
    if (grayMtr !== undefined) {
      const n = grayMtr === '' || grayMtr === null ? null : parseFloat(String(grayMtr))
      data.grayMtr = Number.isFinite(n as number) ? n : null
    }
    await db.reProcessLot.update({ where: { id: existing.id }, data })
  }

  // Recompute totalThan from sources after any add/update/remove later in the
  // function (we do it inline below for addSources path; do it here too to
  // catch update/remove-only edits).
  if ((updateSources && updateSources.length) || (removeSources && removeSources.length)) {
    const fresh = await db.reProcessSource.findMany({ where: { reprocessId: existing.id } })
    const total = fresh.reduce((s: number, r: any) => s + (r.than || 0), 0)
    await db.reProcessLot.update({ where: { id: existing.id }, data: { totalThan: total } })
  }

  // Add more source lots
  if (addSources && Array.isArray(addSources) && addSources.length > 0) {
    const { buildLotInfoMap } = await import('@/lib/lot-info')
    const lotInfoMap = await buildLotInfoMap(addSources.map((s: any) => s.lotNo))

    // Detect quality mismatches up front; ask client to confirm before saving.
    if (!acceptMixedQuality) {
      const conflicts: { lotNo: string; quality: string | null }[] = []
      for (const s of addSources) {
        const info = lotInfoMap.get(s.lotNo.toLowerCase().trim())
        if (info?.quality && info.quality !== existing.quality) {
          conflicts.push({ lotNo: s.lotNo, quality: info.quality })
        }
      }
      if (conflicts.length > 0) {
        return NextResponse.json({
          needsConfirm: true,
          reason: 'MIXED_QUALITY',
          message: `${conflicts.length} added lot(s) have a different quality than ${existing.quality}.`,
          existingQuality: existing.quality,
          conflicts,
        }, { status: 200 })
      }
    }

    let addedThan = 0
    let addedMtr = 0
    for (const s of addSources) {
      const info = lotInfoMap.get(s.lotNo.toLowerCase().trim())
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
    if (status === 'merged') {
      data.mergedAt = new Date()

      // Merge back: update all pipeline records from RE-PRO-{n} to original lots
      // For each source, find its proportional share of the RE-PRO lot
      const reproNo = existing.reproNo
      const sources = existing.sources

      // Update DyeingEntryLot: split RE-PRO lot back to originals
      const dyeLots = await db.dyeingEntryLot.findMany({ where: { lotNo: { equals: reproNo, mode: 'insensitive' } } })
      if (dyeLots.length > 0 && sources.length > 0) {
        // Delete the RE-PRO lot entries and create originals
        for (const dl of dyeLots) {
          let remaining = dl.than
          for (let i = 0; i < sources.length; i++) {
            const s = sources[i]
            const allocThan = i === sources.length - 1 ? remaining : Math.min(s.than, remaining)
            if (allocThan <= 0) continue
            await db.dyeingEntryLot.create({
              data: { entryId: dl.entryId, lotNo: s.originalLotNo, than: allocThan },
            })
            remaining -= allocThan
          }
          await db.dyeingEntryLot.delete({ where: { id: dl.id } })
        }
      }

      // Update FinishEntryLot
      const finLots = await db.finishEntryLot.findMany({ where: { lotNo: { equals: reproNo, mode: 'insensitive' } } })
      if (finLots.length > 0 && sources.length > 0) {
        for (const fl of finLots) {
          let remaining = fl.than
          for (let i = 0; i < sources.length; i++) {
            const s = sources[i]
            const allocThan = i === sources.length - 1 ? remaining : Math.min(s.than, remaining)
            if (allocThan <= 0) continue
            await db.finishEntryLot.create({
              data: { entryId: fl.entryId, lotNo: s.originalLotNo, than: allocThan, meter: fl.meter, status: fl.status, doneThan: fl.doneThan },
            })
            remaining -= allocThan
          }
          await db.finishEntryLot.delete({ where: { id: fl.id } })
        }
      }

      // Update FoldBatchLot
      const foldLots = await db.foldBatchLot.findMany({ where: { lotNo: { equals: reproNo, mode: 'insensitive' } } })
      if (foldLots.length > 0 && sources.length > 0) {
        for (const fbl of foldLots) {
          let remaining = fbl.than
          for (let i = 0; i < sources.length; i++) {
            const s = sources[i]
            const allocThan = i === sources.length - 1 ? remaining : Math.min(s.than, remaining)
            if (allocThan <= 0) continue
            await db.foldBatchLot.create({
              data: { foldBatchId: fbl.foldBatchId, lotNo: s.originalLotNo, than: allocThan },
            })
            remaining -= allocThan
          }
          await db.foldBatchLot.delete({ where: { id: fbl.id } })
        }
      }

      // Update DyeingEntry.lotNo header field
      await db.dyeingEntry.updateMany({
        where: { lotNo: { equals: reproNo, mode: 'insensitive' } },
        data: { lotNo: sources[0].originalLotNo },
      })

      // Update FinishEntry.lotNo header field
      await db.finishEntry.updateMany({
        where: { lotNo: { equals: reproNo, mode: 'insensitive' } },
        data: { lotNo: sources[0].originalLotNo },
      })
    }
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
