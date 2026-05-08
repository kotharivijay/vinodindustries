export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Fetch everything we need in parallel
  const [greyEntries, obBalances, despatchesParent, despatchLotRows, foldBatchLots] = await Promise.all([
    // RULE: lots that arrive with startStage set (e.g. 'finish' or 'folding')
    // skip the grey pipeline and are already allocated to a downstream stock
    // pool. Counting them here would double-allocate. Only rows with
    // startStage IS NULL count as unallocated grey stock.
    prisma.greyEntry.findMany({
      where: { startStage: null },
      select: { lotNo: true, than: true, weight: true, marka: true, grayMtr: true, date: true, challanNo: true, party: { select: { name: true } }, quality: { select: { name: true } } },
    }),
    db.lotOpeningBalance.findMany({
      include: { allocations: true },
    }),
    // Legacy single-lot despatches (no children) — use parent.lotNo + parent.than
    prisma.despatchEntry.findMany({
      where: { despatchLots: { none: {} } },
      select: { lotNo: true, than: true },
    }),
    // Multi-lot despatches — child rows hold the per-lot than
    prisma.despatchEntryLot.findMany({
      select: { lotNo: true, than: true },
    }),
    // Skip cancelled batches — their than returns to the unallocated pool.
    db.foldBatchLot.findMany({
      where: { foldBatch: { cancelled: false } },
      select: { lotNo: true, than: true },
    }),
  ])

  // Sum despatched than per lot (lowercase key) — combine legacy parents + child lot rows
  const despatchedMap = new Map<string, number>()
  for (const d of despatchesParent) {
    const k = d.lotNo.toLowerCase().trim()
    despatchedMap.set(k, (despatchedMap.get(k) || 0) + (d.than || 0))
  }
  for (const d of despatchLotRows) {
    const k = d.lotNo.toLowerCase().trim()
    despatchedMap.set(k, (despatchedMap.get(k) || 0) + (d.than || 0))
  }

  // Sum folded than per lot (if folded, it's been allocated to a batch — not available)
  const foldedMap = new Map<string, number>()
  for (const f of foldBatchLots) {
    const k = f.lotNo.toLowerCase().trim()
    foldedMap.set(k, (foldedMap.get(k) || 0) + (f.than || 0))
  }

  type Lot = {
    lotNo: string
    remaining: number
    party: string
    partyTag: string | null
    quality: string
    weight: string | null
    marka: string | null
    grayMtr: number | null
    date: Date | null
    challanNos: string
    isOB: boolean
    originalThan: number
    deducted: { despatched: number; folded: number; obAllocated: number }
  }

  // Build party → tag lookup for downstream conditional fields
  const allParties = await prisma.party.findMany({ select: { name: true, tag: true } })
  const partyTagMap = new Map<string, string | null>()
  for (const p of allParties) partyTagMap.set(p.name, p.tag)

  const lots: Lot[] = []

  // Process current-year grey entries (aggregate by lot across multiple inwards)
  const greyByLot = new Map<string, { than: number; weight: string | null; marka: string | null; grayMtr: number | null; date: Date; party: string; quality: string; challans: Set<string> }>()
  for (const g of greyEntries) {
    const k = g.lotNo.toLowerCase().trim()
    const existing = greyByLot.get(k)
    if (existing) {
      existing.than += g.than
      if (g.grayMtr) existing.grayMtr = (existing.grayMtr || 0) + g.grayMtr
      if (g.date > existing.date) existing.date = g.date
      if (g.challanNo != null) existing.challans.add(String(g.challanNo))
      if (!existing.marka && g.marka) existing.marka = g.marka
    } else {
      const challans = new Set<string>()
      if (g.challanNo != null) challans.add(String(g.challanNo))
      greyByLot.set(k, {
        than: g.than,
        weight: g.weight,
        marka: g.marka || null,
        grayMtr: g.grayMtr,
        date: g.date,
        party: g.party?.name || 'Unknown',
        quality: g.quality?.name || 'Unknown',
        challans,
      })
    }
  }

  for (const [k, g] of greyByLot) {
    const despatched = despatchedMap.get(k) || 0
    const folded = foldedMap.get(k) || 0
    const remaining = g.than - despatched - folded
    if (remaining <= 0) continue

    // Find original lotNo casing
    const orig = greyEntries.find(x => x.lotNo.toLowerCase().trim() === k)?.lotNo || k
    lots.push({
      lotNo: orig,
      remaining,
      party: g.party,
      partyTag: partyTagMap.get(g.party) || null,
      quality: g.quality,
      weight: g.weight,
      marka: g.marka,
      grayMtr: g.grayMtr,
      date: g.date,
      challanNos: Array.from(g.challans).sort().join(', '),
      isOB: false,
      originalThan: g.than,
      deducted: { despatched, folded, obAllocated: 0 },
    })
  }

  // Process OB (carry-forward) — subtract OB allocations + despatched + folded
  for (const ob of obBalances) {
    const k = ob.lotNo.toLowerCase().trim()
    // Skip if current-year grey also has this lotNo (would double-count)
    if (greyByLot.has(k)) continue

    const despatched = despatchedMap.get(k) || 0
    const folded = foldedMap.get(k) || 0
    const obAllocated = (ob.allocations || []).reduce((s: number, a: any) => s + (a.than || 0), 0)
    const remaining = ob.openingThan - despatched - folded - obAllocated
    if (remaining <= 0) continue

    const obParty = ob.party || 'Unknown'
    lots.push({
      lotNo: ob.lotNo,
      remaining,
      party: obParty,
      partyTag: partyTagMap.get(obParty) || null,
      quality: ob.quality || 'Unknown',
      weight: ob.weight,
      marka: ob.marka || null,
      grayMtr: ob.grayMtr,
      date: ob.greyDate,
      challanNos: '',
      isOB: true,
      originalThan: ob.openingThan,
      deducted: { despatched, folded, obAllocated },
    })
  }

  // Active RE-PRO lots — show as "Re-Process" party until merged.
  try {
    const repros = await db.reProcessLot.findMany({
      where: { status: { in: ['pending', 'in-dyeing', 'finished'] } },
    })
    for (const r of repros) {
      const k = r.reproNo.toLowerCase().trim()
      const despatched = despatchedMap.get(k) || 0
      const folded = foldedMap.get(k) || 0
      const remaining = r.totalThan - despatched - folded
      if (remaining <= 0) continue
      lots.push({
        lotNo: r.reproNo,
        remaining,
        party: 'Re-Process',
        partyTag: null,
        quality: r.quality || 'Unknown',
        weight: r.weight,
        marka: null,
        grayMtr: r.grayMtr,
        date: r.createdAt,
        challanNos: '',
        isOB: false,
        originalThan: r.totalThan,
        deducted: { despatched, folded, obAllocated: 0 },
      })
    }
  } catch {}

  // Group into hierarchy: party -> quality -> lots
  type QualityGroup = { quality: string; totalThan: number; lots: Lot[] }
  type PartyGroup = { party: string; totalThan: number; totalLots: number; qualities: QualityGroup[] }

  const partyMap = new Map<string, Map<string, Lot[]>>()
  for (const l of lots) {
    if (!partyMap.has(l.party)) partyMap.set(l.party, new Map())
    const qMap = partyMap.get(l.party)!
    if (!qMap.has(l.quality)) qMap.set(l.quality, [])
    qMap.get(l.quality)!.push(l)
  }

  const parties: PartyGroup[] = []
  for (const [party, qMap] of partyMap) {
    const qualities: QualityGroup[] = []
    let partyThan = 0
    let partyLots = 0
    for (const [quality, qLots] of qMap) {
      qLots.sort((a, b) => a.lotNo.localeCompare(b.lotNo))
      const qTotal = qLots.reduce((s, l) => s + l.remaining, 0)
      qualities.push({ quality, totalThan: qTotal, lots: qLots })
      partyThan += qTotal
      partyLots += qLots.length
    }
    qualities.sort((a, b) => a.quality.localeCompare(b.quality))
    parties.push({ party, totalThan: partyThan, totalLots: partyLots, qualities })
  }
  parties.sort((a, b) => a.party.localeCompare(b.party))

  const grandTotal = parties.reduce((s, p) => s + p.totalThan, 0)
  const totalLots = parties.reduce((s, p) => s + p.totalLots, 0)

  return NextResponse.json({ parties, grandTotal, totalLots, totalParties: parties.length })
}
