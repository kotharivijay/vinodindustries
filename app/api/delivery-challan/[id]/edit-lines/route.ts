export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// POST — edit an issued challan's lines in place (settings-gated in the UI).
// Body: { addFelIds?: number[], removeLineIds?: number[] }
//  • removeLineIds → delete those FinishDeliveryChallanLine rows (their FELs
//    return to the queue automatically).
//  • addFelIds → attach queued finish-lots to this challan, snapshotting
//    quality / transport / effective shade exactly like the create flow.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const challanId = parseInt(id)
  if (!Number.isFinite(challanId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const addFelIds: number[] = Array.isArray(body.addFelIds) ? body.addFelIds.map((x: any) => parseInt(String(x))).filter(Number.isFinite) : []
  const removeLineIds: number[] = Array.isArray(body.removeLineIds) ? body.removeLineIds.map((x: any) => parseInt(String(x))).filter(Number.isFinite) : []
  if (!addFelIds.length && !removeLineIds.length) {
    return NextResponse.json({ error: 'NO_CHANGES', message: 'Nothing to add or remove.' }, { status: 400 })
  }

  const challan = await db.finishDeliveryChallan.findUnique({ where: { id: challanId }, select: { id: true, challanNo: true, partyId: true, party: { select: { name: true } } } })
  if (!challan) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // ── Remove ───────────────────────────────────────────────────────────────
  if (removeLineIds.length) {
    // Only delete lines that actually belong to this challan (guard).
    await db.finishDeliveryChallanLine.deleteMany({ where: { id: { in: removeLineIds }, challanId } })
  }

  // ── Add ──────────────────────────────────────────────────────────────────
  if (addFelIds.length) {
    const fels = await db.finishEntryLot.findMany({
      where: { id: { in: addFelIds } },
      include: {
        entry: { select: { id: true, slipNo: true } },
        finishDeliveryChallanLine: { select: { id: true } },
        dyeingEntry: { select: { shadeName: true, shadeDescription: true, foldBatch: { select: { shade: { select: { name: true, colorCategory: true } } } }, additions: { select: { roundNo: true, resultShadeName: true, resultShadeDescription: true } } } },
      },
    })
    const already = fels.filter((f: any) => f.finishDeliveryChallanLine)
    if (already.length) {
      return NextResponse.json({ error: 'ALREADY_ON_CHALLAN', message: `${already.length} finish-lot(s) are already on a challan.` }, { status: 409 })
    }

    const lotNos: string[] = [...new Set((fels as any[]).map((f: any) => f.lotNo as string))]
    const greys = await db.greyEntry.findMany({
      where: { lotNo: { in: lotNos, mode: 'insensitive' }, partyId: challan.partyId },
      select: { lotNo: true, transportLrNo: true, date: true, id: true, quality: { select: { name: true } }, transport: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    })
    const qualByLot = new Map<string, string | null>()
    const transByLot = new Map<string, { name: string | null; lrNo: string | null }>()
    for (const g of greys as any[]) {
      const k = g.lotNo.toLowerCase().trim()
      if (!qualByLot.has(k)) qualByLot.set(k, g.quality?.name ?? null)
      if (!transByLot.has(k)) transByLot.set(k, { name: g.transport?.name ?? null, lrNo: g.transportLrNo ?? null })
    }
    // Party guard — every added lot must belong to this challan's party
    const foreign = lotNos.filter((l) => !qualByLot.has(l.toLowerCase().trim()))
    if (foreign.length) {
      return NextResponse.json({ error: 'PARTY_MISMATCH', message: `Lot(s) ${foreign.join(', ')} do not belong to ${challan.party.name}.` }, { status: 400 })
    }

    const { effectiveShade } = await import('@/lib/effective-shade')
    await db.finishDeliveryChallanLine.createMany({
      data: (fels as any[]).map((f: any) => {
        const key = f.lotNo.toLowerCase().trim()
        const tp = transByLot.get(key)
        const de = f.dyeingEntry
        const eff = de ? effectiveShade({ shadeName: de.shadeName || de.foldBatch?.shade?.name || null, shadeDescription: de.shadeDescription ?? null, additions: de.additions }) : null
        return {
          challanId,
          finishEntryLotId: f.id,
          finishEntryId: f.entry.id,
          finishSlipNo: f.entry.slipNo,
          lotNo: f.lotNo,
          qualityName: qualByLot.get(key) ?? null,
          shadeName: eff?.name ?? null,
          shadeCategory: eff?.changed ? null : (f.dyeingEntry?.foldBatch?.shade?.colorCategory || null),
          than: f.status === 'done' ? f.than : f.doneThan,
          meter: null,
          transportName: tp?.name ?? null,
          transportLrNo: tp?.lrNo ?? null,
        }
      }),
    })
  }

  const updated = await db.finishDeliveryChallan.findUnique({
    where: { id: challanId },
    include: { party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } }, lines: { orderBy: { id: 'asc' } } },
  })
  return NextResponse.json(updated)
}
