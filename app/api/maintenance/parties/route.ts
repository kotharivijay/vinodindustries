export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const norm = (s: string) => (s || '').trim().toLowerCase()

/**
 * GET — preview the Party master cleanup.
 * Buckets every Party row into:
 *   - inLedger  : name found in TallyLedger (any firm)
 *   - linked    : not in ledger but referenced by ≥1 entry (typo-style; needs merge)
 *   - orphan    : not in ledger AND zero references (safe to delete)
 *
 * Returns counts + the orphan list so the UI can show what'll go.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [parties, ledgers] = await Promise.all([
    prisma.party.findMany({
      include: {
        _count: {
          select: {
            greyEntries: true,
            despatchEntries: true,
            foldBatchLots: true,
            finishRecipes: true,
            finishRecipeTags: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.tallyLedger.findMany({ select: { name: true } }),
  ])

  const ledgerSet = new Set(ledgers.map(l => norm(l.name)))
  const totalRefs = (p: any) =>
    p._count.greyEntries + p._count.despatchEntries + p._count.foldBatchLots
    + p._count.finishRecipes + p._count.finishRecipeTags

  const orphans: any[] = []
  const linked: any[] = []
  let inLedger = 0

  for (const p of parties) {
    const isInLedger = ledgerSet.has(norm(p.name))
    const refs = totalRefs(p)
    if (isInLedger) inLedger++
    else if (refs === 0) orphans.push({ id: p.id, name: p.name, tag: p.tag })
    else linked.push({
      id: p.id, name: p.name, tag: p.tag,
      grey: p._count.greyEntries,
      despatch: p._count.despatchEntries,
      fold: p._count.foldBatchLots,
      finishRecipe: p._count.finishRecipes + p._count.finishRecipeTags,
      total: refs,
    })
  }

  return NextResponse.json({
    counts: { total: parties.length, inLedger, linked: linked.length, orphans: orphans.length },
    orphans,
    linked,
  })
}

/**
 * POST — delete orphan parties by id.
 * Body: { ids: number[] }
 * Each id is verified to be NOT in TallyLedger AND have zero refs before
 * deletion — same gate the GET preview applies. So even if the request is
 * stale, the server won't drop a row that became referenced in the meantime.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(body?.ids) ? body.ids.map((x: any) => Number(x)).filter(Number.isFinite) : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids[] required' }, { status: 400 })

  const [parties, ledgers] = await Promise.all([
    prisma.party.findMany({
      where: { id: { in: ids } },
      include: {
        _count: { select: { greyEntries: true, despatchEntries: true, foldBatchLots: true, finishRecipes: true, finishRecipeTags: true } },
      },
    }),
    prisma.tallyLedger.findMany({ select: { name: true } }),
  ])
  const ledgerSet = new Set(ledgers.map(l => norm(l.name)))

  const safeIds: number[] = []
  const skipped: { id: number, reason: string }[] = []
  for (const p of parties) {
    if (ledgerSet.has(norm(p.name))) {
      skipped.push({ id: p.id, reason: 'now exists in TallyLedger' }); continue
    }
    const refs = (p._count.greyEntries + p._count.despatchEntries + p._count.foldBatchLots
      + p._count.finishRecipes + p._count.finishRecipeTags)
    if (refs > 0) {
      skipped.push({ id: p.id, reason: `now has ${refs} reference(s)` }); continue
    }
    safeIds.push(p.id)
  }

  let deleted = 0
  if (safeIds.length) {
    const r = await prisma.party.deleteMany({ where: { id: { in: safeIds } } })
    deleted = r.count
  }
  return NextResponse.json({ ok: true, deleted, skipped })
}
