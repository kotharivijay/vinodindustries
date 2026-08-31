// What a party can still send back as a grey return, in two buckets.
//
//   grey — plain grey never committed to a fold batch. Canonical formula from
//          app/api/grey/unallocated-stock/route.ts:
//            than − max(despatched, folded) − alreadyReturned(grey)
//          `max(...)` rather than a sum because despatch keeps the original
//          grey lotNo all the way through fold→dye→finish, so subtracting both
//          would double-count the same cloth.
//
//   fold — cloth in a fold batch that has NOT been dyed. Offered per fold LINE
//          (FoldBatchLot), because a return must reduce a specific line. A
//          batch that already has a dyeing slip is excluded — that cloth is in
//          dyeing, not returnable.
//
// Grey checking reserves nothing, so checked cloth already sits in the grey
// bucket; its slip no is surfaced only so the picker can badge it.

import { prisma } from '@/lib/prisma'

const db = prisma as any
export const key = (s: string) => s.toLowerCase().trim()

export type GreyRow = {
  lotNo: string; quality: string; marka: string | null
  available: number; checkingSlipNo: string | null; date: Date
}
export type FoldRow = {
  foldBatchLotId: number; lotNo: string; quality: string; marka: string | null
  foldNo: string | null; batchNo: number | null
  available: number; checkingSlipNo: string | null
}
export type Availability = {
  party: { id: number; name: string; tag: string | null }
  grey: GreyRow[]
  fold: FoldRow[]
  totals: { greyThan: number; foldThan: number; lots: number }
}

export async function greyReturnAvailability(partyId: number): Promise<Availability | null> {
  const party = await db.party.findUnique({ where: { id: partyId }, select: { id: true, name: true, tag: true } })
  if (!party) return null

  // startStage != null means the lot entered the pipeline already
  // finished/folding, so it was never plain grey here.
  const greys = await db.greyEntry.findMany({
    where: { partyId, startStage: null },
    select: { lotNo: true, than: true, marka: true, date: true, quality: { select: { name: true } } },
  })
  const empty: Availability = { party, grey: [], fold: [], totals: { greyThan: 0, foldThan: 0, lots: 0 } }
  if (!greys.length) return empty

  const lotNos = [...new Set((greys as any[]).map((g: any) => g.lotNo as string))] as string[]

  const [despParents, despChildren, foldLots, returned, checks] = await Promise.all([
    db.despatchEntry.findMany({ where: { lotNo: { in: lotNos, mode: 'insensitive' }, despatchLots: { none: {} } }, select: { lotNo: true, than: true } }),
    db.despatchEntryLot.findMany({ where: { lotNo: { in: lotNos, mode: 'insensitive' } }, select: { lotNo: true, than: true } }),
    db.foldBatchLot.findMany({
      where: { lotNo: { in: lotNos, mode: 'insensitive' }, foldBatch: { cancelled: false } },
      select: {
        id: true, lotNo: true, than: true,
        quality: { select: { name: true } },
        foldBatch: {
          select: {
            batchNo: true, marka: true,
            foldProgram: { select: { foldNo: true } },
            dyeingEntries: { select: { id: true } },
          },
        },
      },
    }),
    db.greyReturnLot.findMany({
      where: { lotNo: { in: lotNos, mode: 'insensitive' }, greyReturn: { status: 'issued' } },
      select: { lotNo: true, than: true, source: true, foldBatchLotId: true },
    }),
    db.checkingSlipLot.findMany({
      where: { lotNo: { in: lotNos, mode: 'insensitive' } },
      select: { lotNo: true, checkingSlip: { select: { slipNo: true } } },
    }),
  ])

  const despMap = new Map<string, number>()
  for (const r of [...(despParents as any[]), ...(despChildren as any[])]) {
    despMap.set(key(r.lotNo), (despMap.get(key(r.lotNo)) || 0) + (r.than || 0))
  }
  const foldedMap = new Map<string, number>()
  for (const f of foldLots as any[]) foldedMap.set(key(f.lotNo), (foldedMap.get(key(f.lotNo)) || 0) + (f.than || 0))

  // ALL returns reduce the grey pool, both sources — this is the subtle bit.
  // grey available = than − max(despatched, foldedNow) − returned.
  // A fold-sourced return shrank its FoldBatchLot, which LOWERS `foldedNow`
  // and would otherwise release that than back into the grey pool even though
  // the cloth physically left. Subtracting the return cancels that out:
  //   100 grey, 30 folded, return 20 folded → fold becomes 10,
  //   100 − max(0,10) − 20 = 70 plain grey + 10 in fold = 80 on hand ✓
  const returnedMap = new Map<string, number>()
  for (const r of returned as any[]) {
    returnedMap.set(key(r.lotNo), (returnedMap.get(key(r.lotNo)) || 0) + r.than)
  }
  const checkedMap = new Map<string, string>()
  for (const c of checks as any[]) {
    const k = key(c.lotNo)
    if (!checkedMap.has(k)) checkedMap.set(k, c.checkingSlip?.slipNo ?? '')
  }

  // ── Bucket 1: plain grey ──
  const greyByLot = new Map<string, { lotNo: string; than: number; quality: string; marka: string | null; date: Date }>()
  for (const g of greys as any[]) {
    const k = key(g.lotNo)
    const e = greyByLot.get(k)
    if (e) {
      e.than += g.than
      if (!e.marka && g.marka) e.marka = g.marka
      if (g.date > e.date) e.date = g.date
    } else {
      greyByLot.set(k, { lotNo: g.lotNo, than: g.than, quality: g.quality?.name ?? '-', marka: g.marka ?? null, date: g.date })
    }
  }

  const grey: GreyRow[] = []
  for (const [k, g] of greyByLot) {
    const consumed = Math.max(despMap.get(k) || 0, foldedMap.get(k) || 0)
    const available = g.than - consumed - (returnedMap.get(k) || 0)
    if (available <= 0) continue
    grey.push({ lotNo: g.lotNo, quality: g.quality, marka: g.marka, available, checkingSlipNo: checkedMap.get(k) || null, date: g.date })
  }
  grey.sort((a, b) => a.lotNo.localeCompare(b.lotNo))

  // ── Bucket 2: folded, not dyed ──
  const fold: FoldRow[] = []
  for (const fl of foldLots as any[]) {
    if (fl.foldBatch?.dyeingEntries?.length) continue   // already in dyeing
    if (fl.than <= 0) continue
    fold.push({
      foldBatchLotId: fl.id,
      lotNo: fl.lotNo,
      quality: fl.quality?.name ?? greyByLot.get(key(fl.lotNo))?.quality ?? '-',
      marka: fl.foldBatch?.marka ?? greyByLot.get(key(fl.lotNo))?.marka ?? null,
      foldNo: fl.foldBatch?.foldProgram?.foldNo ?? null,
      batchNo: fl.foldBatch?.batchNo ?? null,
      available: fl.than,
      checkingSlipNo: checkedMap.get(key(fl.lotNo)) || null,
    })
  }
  fold.sort((a, b) => a.lotNo.localeCompare(b.lotNo) || (a.batchNo ?? 0) - (b.batchNo ?? 0))

  return {
    party, grey, fold,
    totals: {
      greyThan: grey.reduce((s, r) => s + r.available, 0),
      foldThan: fold.reduce((s, r) => s + r.available, 0),
      lots: new Set([...grey.map(r => key(r.lotNo)), ...fold.map(r => key(r.lotNo))]).size,
    },
  }
}
