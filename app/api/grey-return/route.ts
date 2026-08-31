export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCurrentFy } from '@/lib/inv/series'
import { greyReturnAvailability, key } from '@/lib/grey-return-available'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyId = req.nextUrl.searchParams.get('partyId')
  const returns = await db.greyReturn.findMany({
    where: partyId ? { partyId: Number(partyId) } : {},
    include: {
      party: { select: { id: true, name: true, tag: true } },
      lots: {
        orderBy: { id: 'asc' },
        include: { finishDeliveryChallanLine: { select: { challan: { select: { id: true, challanNo: true, date: true, status: true } } } } },
      },
    },
    orderBy: { serialNo: 'desc' },
    take: 300,
  })

  return NextResponse.json((returns as any[]).map((r: any) => ({
    ...r,
    totalThan: r.lots.reduce((s: number, l: any) => s + l.than, 0),
    greyThan: r.lots.filter((l: any) => l.source === 'grey').reduce((s: number, l: any) => s + l.than, 0),
    foldThan: r.lots.filter((l: any) => l.source === 'fold').reduce((s: number, l: any) => s + l.than, 0),
    challanNos: [...new Set(r.lots.map((l: any) => l.finishDeliveryChallanLine?.challan?.challanNo).filter((x: any) => x != null))],
  })))
}

// POST — create a grey return.
//
// Every than is RE-VALIDATED against live availability inside the transaction;
// the client's numbers are never trusted. Fold-sourced lines also SHRINK their
// FoldBatchLot, because the grey-stock formula subtracts max(despatched,
// folded) — without the shrink the returned than would silently reappear as
// available grey.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { partyId, date, notes, lots } = body as {
    partyId: number; date: string; notes?: string
    lots: Array<{ source: 'grey' | 'fold'; lotNo: string; than: number; meter?: number | string | null; foldBatchLotId?: number }>
  }

  if (!partyId || !date || !Array.isArray(lots) || lots.length === 0) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'partyId, date and at least one lot are required' }, { status: 400 })
  }
  for (const l of lots) {
    if (!l.lotNo || !Number.isFinite(Number(l.than)) || Number(l.than) <= 0) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: `Bad than for lot ${l.lotNo}` }, { status: 400 })
    }
    if (l.source !== 'grey' && l.source !== 'fold') {
      return NextResponse.json({ error: 'INVALID_INPUT', message: `Unknown source "${l.source}"` }, { status: 400 })
    }
    if (l.source === 'fold' && !Number.isFinite(Number(l.foldBatchLotId))) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: `Fold line ${l.lotNo} is missing foldBatchLotId` }, { status: 400 })
    }
  }

  const party = await db.party.findUnique({ where: { id: Number(partyId) }, select: { id: true, name: true } })
  if (!party) return NextResponse.json({ error: 'PARTY_NOT_FOUND' }, { status: 404 })

  // Re-derive availability from the SAME function the picker reads, so the
  // client's numbers are never trusted and the two can't drift apart.
  const avail = await greyReturnAvailability(party.id)
  if (!avail) return NextResponse.json({ error: 'PARTY_NOT_FOUND' }, { status: 404 })
  const greyAvail = new Map<string, number>(avail.grey.map(g => [key(g.lotNo), g.available]))
  const greyMeta = new Map<string, any>(avail.grey.map(g => [key(g.lotNo), g]))
  const foldAvail = new Map<number, any>(avail.fold.map(f => [f.foldBatchLotId, f]))

  // Guard against the same source being picked twice in ONE request.
  const greyUsed = new Map<string, number>()
  const foldUsed = new Map<number, number>()
  const messages: string[] = []
  for (const l of lots) {
    const than = Number(l.than)
    if (l.source === 'grey') {
      const k = key(l.lotNo)
      const cap = greyAvail.get(k) ?? 0
      const used = (greyUsed.get(k) || 0) + than
      if (used > cap) messages.push(`${l.lotNo}: ${used} than exceeds available grey ${cap}`)
      greyUsed.set(k, used)
    } else {
      const id = Number(l.foldBatchLotId)
      const line = foldAvail.get(id)
      if (!line) { messages.push(`${l.lotNo}: fold line no longer returnable (batch may have gone to dyeing)`); continue }
      const used = (foldUsed.get(id) || 0) + than
      if (used > line.available) messages.push(`${l.lotNo}: ${used} than exceeds fold line ${line.foldNo}/b${line.batchNo} (${line.available})`)
      foldUsed.set(id, used)
    }
  }
  if (messages.length) return NextResponse.json({ error: 'INSUFFICIENT_STOCK', messages }, { status: 400 })

  const fy = getCurrentFy()
  try {
    const created = await db.$transaction(async (tx: any) => {
      // Gap-free series (CLAUDE.md rule 10) — bumped in the same transaction
      // as the insert, so a failure can't burn a number.
      const counter = await tx.invSeriesCounter.upsert({
        where: { seriesType_fy: { seriesType: 'grey-return', fy } },
        create: { seriesType: 'grey-return', fy, lastNo: 1 },
        update: { lastNo: { increment: 1 } },
      })
      const serialNo = counter.lastNo

      // Shrink each fold line by the returned than (delete it if fully returned).
      for (const [foldBatchLotId, than] of foldUsed) {
        const line = await tx.foldBatchLot.findUnique({ where: { id: foldBatchLotId }, select: { than: true } })
        if (!line) throw Object.assign(new Error('FOLD_LINE_GONE'), { code: 'FOLD_LINE_GONE' })
        if (than >= line.than) await tx.foldBatchLot.delete({ where: { id: foldBatchLotId } })
        else await tx.foldBatchLot.update({ where: { id: foldBatchLotId }, data: { than: line.than - than } })
      }

      return tx.greyReturn.create({
        data: {
          slipNo: `GR-${serialNo}`,
          serialNo, fy,
          date: new Date(date),
          partyId: party.id,
          status: 'issued',
          notes: notes?.trim() || null,
          createdByEmail: (session as any)?.user?.email ?? null,
          lots: {
            create: lots.map(l => {
              const meta = l.source === 'grey' ? greyMeta.get(key(l.lotNo)) : foldAvail.get(Number(l.foldBatchLotId))
              const mtr = l.meter === '' || l.meter == null ? null : Number(l.meter)
              return {
                lotNo: l.lotNo,
                source: l.source,
                qualityName: meta?.quality ?? null,
                marka: meta?.marka ?? null,
                than: Number(l.than),
                meter: Number.isFinite(mtr as number) && (mtr as number) > 0 ? mtr : null,
                foldBatchLotId: l.source === 'fold' ? Number(l.foldBatchLotId) : null,
                checkingSlipNo: meta?.checkingSlipNo ?? null,
              }
            }),
          },
        },
        include: { lots: true, party: { select: { id: true, name: true } } },
      })
    })
    return NextResponse.json(created)
  } catch (e: any) {
    if (e?.code === 'FOLD_LINE_GONE') {
      return NextResponse.json({ error: 'FOLD_LINE_GONE', message: 'A fold line changed while saving — reload and try again.' }, { status: 409 })
    }
    if (String(e?.code) === 'P2002') {
      return NextResponse.json({ error: 'DUPLICATE_SLIP_NO', message: 'Slip number collided — try again.' }, { status: 409 })
    }
    throw e
  }
}
