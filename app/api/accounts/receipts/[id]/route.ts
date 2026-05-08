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
      allocations: { include: { receipt: { select: { id: true, vchNumber: true, date: true, amount: true } } } },
    },
    orderBy: { date: 'desc' },
    take: 100,
  })

  // Compute pending = totalAmount − sum(allocations) per invoice
  const enriched = invoices.map((inv: any) => {
    const allocated = (inv.allocations || []).reduce((s: number, a: any) => s + (a.allocatedAmount || 0), 0)
    return { ...inv, allocated, pending: Math.max(0, inv.totalAmount - allocated) }
  })

  return NextResponse.json({ receipt, invoices: enriched })
}
