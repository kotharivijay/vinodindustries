export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET /api/accounts/sales/parties
// Returns the union of partyName strings already in KsiSalesInvoice + the
// distinct payer side of KsiHdfcReceipt — so the opening-balance modal can
// pre-populate every party the operator has ever transacted with.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [invs, recs] = await Promise.all([
    db.ksiSalesInvoice.findMany({
      distinct: ['partyName'],
      select: { partyName: true },
      orderBy: { partyName: 'asc' },
    }),
    // partyName is a non-nullable String in the schema; the old { not: null }
    // clause throws under Prisma 5.x strict validation. Distinct + the empty
    // guard on the consumer side is sufficient.
    db.ksiHdfcReceipt.findMany({
      distinct: ['partyName'],
      select: { partyName: true },
      orderBy: { partyName: 'asc' },
    }),
  ])
  const set = new Set<string>()
  for (const r of invs) if (r.partyName) set.add(r.partyName)
  for (const r of recs) if (r.partyName) set.add(r.partyName)
  return NextResponse.json({ parties: Array.from(set).sort((a, b) => a.localeCompare(b)) })
}
