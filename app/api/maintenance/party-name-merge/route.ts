export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// More forgiving than the outstanding/refresh-partyname canon: it also
// tightens whitespace around common punctuation so "X(Y)" and "X (Y)"
// collide. That's the real duplicate pattern we see (e.g. operator-typed
// OB rows lose the space before the suffix).
function canon(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s*([(),&\-/])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * GET /api/maintenance/party-name-merge
 *
 * Scans KsiSalesInvoice + KsiHdfcReceipt partyName values, canonicalizes
 * them (lowercase + tightened punctuation), and returns every canonical
 * key that has 2+ raw variants — these are the candidates for merging.
 *
 * Response:
 *   {
 *     groups: [
 *       {
 *         canonical: "prakash shirting(process)",
 *         variants: [
 *           { name: "PRAKASH SHIRTING(PROCESS)", invoiceCount: 308, receiptCount: 40 },
 *           { name: "Prakash ShIrting (Process)", invoiceCount: 20, receiptCount: 0 },
 *         ],
 *       },
 *       ...
 *     ]
 *   }
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [invs, recs] = await Promise.all([
    db.ksiSalesInvoice.groupBy({
      by: ['partyName'],
      _count: { id: true },
    }),
    db.ksiHdfcReceipt.groupBy({
      by: ['partyName'],
      _count: { id: true },
    }),
  ])

  const invByName = new Map<string, number>()
  for (const r of invs) invByName.set(r.partyName, r._count.id)
  const recByName = new Map<string, number>()
  for (const r of recs) if (r.partyName) recByName.set(r.partyName, r._count.id)

  // Union of all distinct names from both tables
  const all = new Set<string>([...invByName.keys(), ...recByName.keys()])
  const groupsByCanon = new Map<string, Array<{ name: string; invoiceCount: number; receiptCount: number }>>()
  for (const name of all) {
    const k = canon(name)
    if (!groupsByCanon.has(k)) groupsByCanon.set(k, [])
    groupsByCanon.get(k)!.push({
      name,
      invoiceCount: invByName.get(name) || 0,
      receiptCount: recByName.get(name) || 0,
    })
  }

  // Keep only canonicals with 2+ variants and sort each group by row count (desc).
  const groups = [...groupsByCanon.entries()]
    .filter(([, vs]) => vs.length > 1)
    .map(([canonical, variants]) => ({
      canonical,
      variants: variants.sort((a, b) => (b.invoiceCount + b.receiptCount) - (a.invoiceCount + a.receiptCount)),
    }))
    .sort((a, b) => {
      const totalA = a.variants.reduce((s, v) => s + v.invoiceCount + v.receiptCount, 0)
      const totalB = b.variants.reduce((s, v) => s + v.invoiceCount + v.receiptCount, 0)
      return totalB - totalA
    })

  return NextResponse.json({ groups })
}

/**
 * POST /api/maintenance/party-name-merge
 * Body: { canonical: string, variants: string[] }
 *
 * Updates every KsiSalesInvoice + KsiHdfcReceipt row whose partyName is
 * in `variants` to use `canonical` instead. Both tables are updated in
 * one transaction. Variants identical to canonical are no-ops (no risk).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const canonical = String(body.canonical || '').trim()
  const variants: string[] = Array.isArray(body.variants)
    ? body.variants.map((s: any) => String(s)).filter(Boolean)
    : []
  if (!canonical) return NextResponse.json({ error: 'canonical required' }, { status: 400 })
  if (variants.length === 0) return NextResponse.json({ error: 'variants[] required' }, { status: 400 })

  // Drop the canonical itself from the rename set if the caller included it.
  const toRename = variants.filter(v => v !== canonical)
  if (toRename.length === 0) {
    return NextResponse.json({ ok: true, updatedInvoices: 0, updatedReceipts: 0, note: 'No variants differ from canonical.' })
  }

  const [invRes, recRes] = await db.$transaction([
    db.ksiSalesInvoice.updateMany({
      where: { partyName: { in: toRename } },
      data: { partyName: canonical },
    }),
    db.ksiHdfcReceipt.updateMany({
      where: { partyName: { in: toRename } },
      data: { partyName: canonical },
    }),
  ])

  return NextResponse.json({
    ok: true,
    updatedInvoices: invRes.count,
    updatedReceipts: recRes.count,
    canonical,
    renamed: toRename,
  })
}
