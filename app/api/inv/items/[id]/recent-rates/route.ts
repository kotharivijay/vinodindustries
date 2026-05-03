export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// Categories where a single Tally alias buckets many real items (e.g.
// "Dye 18%" covers every reactive dye). For these, recent-rates pulls
// price history across all sibling items under the same alias so the
// user sees a useful market view. Other categories (Spare, Machinery,
// Chemical) stay strict — each item is its own thing.
const ALIAS_BUCKETED_CATEGORIES = new Set(['Dye', 'Auxiliary'])

/**
 * Last-N challan lines for an item.
 *   GET /api/inv/items/:id/recent-rates?n=5             — across all parties
 *   GET /api/inv/items/:id/recent-rates?partyId=&n=3    — restricted to one party
 *
 * For items whose alias category is in ALIAS_BUCKETED_CATEGORIES, the match
 * widens to "any item sharing this alias". Otherwise it's a strict itemId
 * match. Returns party + item name on each row.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const itemId = Number(params.id)
  const partyIdRaw = req.nextUrl.searchParams.get('partyId')
  const partyId = partyIdRaw ? Number(partyIdRaw) : null
  const n = Math.max(1, Math.min(20, Number(req.nextUrl.searchParams.get('n') || 5)))

  const item = await db.invItem.findUnique({
    where: { id: itemId },
    select: { id: true, aliasId: true, alias: { select: { category: true } } },
  })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const aliasBucketed = ALIAS_BUCKETED_CATEGORIES.has(item.alias?.category ?? '')
  const where: any = { rate: { not: null } }
  if (aliasBucketed) {
    // Sibling match by alias
    where.item = { aliasId: item.aliasId }
  } else {
    where.itemId = itemId
  }
  if (partyId) where.challan = { partyId }

  const lines = await db.invChallanLine.findMany({
    where,
    select: {
      rate: true,
      qty: true,
      unit: true,
      itemId: true,
      item: { select: { displayName: true } },
      challan: {
        select: {
          challanDate: true,
          challanNo: true,
          party: { select: { id: true, displayName: true } },
        },
      },
    },
    orderBy: { challan: { challanDate: 'desc' } },
    take: n,
  })
  return NextResponse.json(lines.map((l: any) => ({
    rate: Number(l.rate),
    qty: Number(l.qty),
    unit: l.unit,
    itemId: l.itemId,
    itemName: l.item?.displayName,
    challanDate: l.challan.challanDate,
    challanNo: l.challan.challanNo,
    partyId: l.challan.party.id,
    partyName: l.challan.party.displayName,
    aliasBucketed, // tells UI whether to render the item-name column
  })))
}
