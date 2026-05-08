export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const VALID = new Set(['extra-charge', 'discount', 'tax', 'party', 'ignore'])

// GET — list of unique ledger names found across all KSI sales invoices,
// joined with their existing category (if any), plus per-ledger totals so
// the user knows which ones matter most.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const grouped = await db.ksiSalesInvoiceLedger.groupBy({
    by: ['ledgerName'],
    _sum: { amount: true },
    _count: { _all: true },
  })
  const cats = await db.ksiSalesLedgerCategory.findMany()
  const catMap = new Map<string, any>()
  for (const c of cats) catMap.set(c.ledgerName.toLowerCase(), c)

  const rows = grouped.map((g: any) => {
    const c = catMap.get(g.ledgerName.toLowerCase())
    return {
      ledgerName: g.ledgerName,
      occurrences: g._count._all,
      totalSigned: g._sum.amount ?? 0,
      category: c?.category ?? null,
      note: c?.note ?? null,
    }
  })
  rows.sort((a: any, b: any) => Math.abs(b.totalSigned) - Math.abs(a.totalSigned))
  return NextResponse.json({ rows })
}

// POST { ledgerName, category, note? } — upsert
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { ledgerName, category, note } = await req.json().catch(() => ({}))
  if (!ledgerName || !category) return NextResponse.json({ error: 'ledgerName + category required' }, { status: 400 })
  if (!VALID.has(category)) return NextResponse.json({ error: `category must be one of ${[...VALID].join(',')}` }, { status: 400 })
  const db = prisma as any
  const row = await db.ksiSalesLedgerCategory.upsert({
    where: { ledgerName },
    create: { ledgerName, category, note: note || null },
    update: { category, note: note || null },
  })
  return NextResponse.json({ ok: true, row })
}

// DELETE { ledgerName } — clear the classification
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { ledgerName } = await req.json().catch(() => ({}))
  if (!ledgerName) return NextResponse.json({ error: 'ledgerName required' }, { status: 400 })
  const db = prisma as any
  await db.ksiSalesLedgerCategory.deleteMany({ where: { ledgerName } })
  return NextResponse.json({ ok: true })
}
