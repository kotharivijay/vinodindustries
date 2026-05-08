export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/accounts/receipts/[id]
// Returns the receipt + party's KSI sales/process invoices + existing
// allocations.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const db = prisma as any
  const receipt = await db.ksiHdfcReceipt.findUnique({
    where: { id },
    include: { allocations: { include: { invoice: true } } },
  })
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Pull invoices for the party (case-insensitive partial match: Tally
  // sometimes uses slightly different capitalisations).
  const invoices = await db.ksiSalesInvoice.findMany({
    where: { partyName: { contains: receipt.partyName.split('(')[0].trim(), mode: 'insensitive' } },
    include: {
      lines: { orderBy: { lineNo: 'asc' } },
      ledgers: true,
      allocations: { include: { receipt: { select: { id: true, vchNumber: true, date: true, amount: true } } } },
    },
    orderBy: { date: 'desc' },
    take: 100,
  })

  // Category map for ledger classification (Net Ask uses extras + discounts)
  const categories = await db.ksiSalesLedgerCategory.findMany()
  const categoryMap: Record<string, string> = {}
  for (const c of categories) categoryMap[c.ledgerName.toLowerCase()] = c.category

  // Pending = totalAmount − Σ(allocatedAmount + tdsAmount + discountAmount).
  // TDS / discount reduce the invoice's outstanding without being cash receipts,
  // so they belong on the "consumed" side just like the cash allocation.
  const enriched = invoices.map((inv: any) => {
    const allocated = (inv.allocations || []).reduce((s: number, a: any) => s + (a.allocatedAmount || 0), 0)
    const tds = (inv.allocations || []).reduce((s: number, a: any) => s + (a.tdsAmount || 0), 0)
    const discount = (inv.allocations || []).reduce((s: number, a: any) => s + (a.discountAmount || 0), 0)
    return {
      ...inv,
      allocated, tds, discount,
      consumed: allocated + tds + discount,
      pending: Math.max(0, inv.totalAmount - allocated - tds - discount),
    }
  })

  return NextResponse.json({ receipt, invoices: enriched, categoryMap })
}
