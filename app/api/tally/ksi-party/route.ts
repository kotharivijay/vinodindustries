export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const FIRM = 'KSI'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const name = req.nextUrl.searchParams.get('name') || ''
  const dateFrom = req.nextUrl.searchParams.get('dateFrom') || ''
  const dateTo = req.nextUrl.searchParams.get('dateTo') || ''

  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const db = viPrisma as any

  try {
    // 1. Ledger info from DB
    const ledger = await db.tallyLedger.findFirst({
      where: { firmCode: FIRM, name: { equals: name, mode: 'insensitive' } },
      select: { name: true, parent: true, address: true, gstNo: true, panNo: true, mobileNos: true, state: true },
    })

    // 2. All outstanding bills for this party
    const outstandingBills = await db.tallyOutstanding.findMany({
      where: { firmCode: FIRM, partyName: { equals: name, mode: 'insensitive' } },
      orderBy: { billDate: 'asc' },
    })

    // 3. Vouchers filtered by date range (for statement)
    const vchWhere: any = {
      firmCode: FIRM,
      partyName: { equals: name, mode: 'insensitive' },
    }
    if (dateFrom || dateTo) {
      vchWhere.date = {}
      if (dateFrom) vchWhere.date.gte = new Date(dateFrom)
      if (dateTo) vchWhere.date.lte = new Date(dateTo + 'T23:59:59.999Z')
    }
    const vouchers = await db.tallySales.findMany({
      where: vchWhere,
      orderBy: { date: 'asc' },
      select: {
        date: true,
        vchNumber: true,
        partyName: true,
        itemName: true,
        quantity: true,
        unit: true,
        rate: true,
        amount: true,
        vchType: true,
        narration: true,
      },
    })

    // 4. Outstanding totals
    let totalReceivable = 0
    let totalPayable = 0
    for (const b of outstandingBills) {
      if (b.type === 'receivable') totalReceivable += b.closingBalance
      else totalPayable += b.closingBalance
    }

    const resp = NextResponse.json({ ledger, outstandingBills, vouchers, totalReceivable, totalPayable })
    resp.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    return resp
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
