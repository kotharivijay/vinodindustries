export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// List transport payments, newest first, with the challans each one covered.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const payments = await db.transportPayment.findMany({
    orderBy: { date: 'desc' },
    include: {
      entries: {
        select: { id: true, challanNo: true, date: true, than: true, party: { select: { name: true } } },
        orderBy: { date: 'asc' },
      },
    },
  })
  return NextResponse.json(payments)
}

// Create a payment voucher covering the given despatch entries.
// Body: { date, paidTo, amount?, mode?, notes?, entryIds: number[] }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  const paidTo = (data.paidTo ?? '').trim()
  const entryIds: number[] = Array.isArray(data.entryIds)
    ? data.entryIds.map((x: any) => parseInt(x)).filter((x: number) => Number.isFinite(x) && x > 0)
    : []
  if (!paidTo) return NextResponse.json({ error: 'Paid-to name is required' }, { status: 400 })
  if (!data.date) return NextResponse.json({ error: 'Date is required' }, { status: 400 })
  if (!entryIds.length) return NextResponse.json({ error: 'Select at least one challan' }, { status: 400 })

  const db = prisma as any
  const already = await db.despatchEntry.findMany({
    where: { id: { in: entryIds }, transportPaymentId: { not: null } },
    select: { challanNo: true, transportPayment: { select: { paidTo: true } } },
  })
  if (already.length) {
    return NextResponse.json({
      error: `Already marked paid: ${already.map((e: any) => `Ch ${e.challanNo} (${e.transportPayment.paidTo})`).join(', ')}`,
    }, { status: 400 })
  }

  const payment = await db.transportPayment.create({
    data: {
      date: new Date(data.date),
      paidTo,
      amount: data.amount != null && data.amount !== '' ? String(data.amount) : null,
      mode: data.mode || null,
      notes: data.notes || null,
      entries: { connect: entryIds.map(id => ({ id })) },
    },
    include: { entries: { select: { id: true, challanNo: true } } },
  })
  return NextResponse.json(payment, { status: 201 })
}
