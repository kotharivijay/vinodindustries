export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma, viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const FIRM = 'KSI'

// Voucher types we explicitly exclude from the party statement.
// Delivery Notes are stock-movement only — they don't post to the party
// account in Tally — so they'd be noise here.
const EXCLUDE_TYPES = new Set(['Delivery Note', 'Delivery note', 'delivery note'])

// Mirror of the frontend's DR_TYPES / CR_TYPES sets — duplicated here on
// purpose so the API can compute the opening balance independently. Keep
// in sync with app/(dashboard)/accounts/ledger/page.tsx.
const DR_TYPES = new Set(['Sales', 'Process Job', 'Debit Note', 'Purchase Return'])
const CR_TYPES = new Set(['Receipt', 'Payment', 'Credit Note', 'Cash', 'Journal'])
function signedFor(vchType: string | null, amount: number) {
  const t = vchType || ''
  if (DR_TYPES.has(t)) return amount
  if (CR_TYPES.has(t)) return -amount
  return 0
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const name = req.nextUrl.searchParams.get('name') || ''
  const dateFrom = req.nextUrl.searchParams.get('dateFrom') || ''
  const dateTo = req.nextUrl.searchParams.get('dateTo') || ''
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const db = prisma as any
  const viDb = viPrisma as any

  try {
    // 1. Ledger master row — still from TallyLedger (synced via /api/tally/ledger-sync).
    const ledger = await viDb.tallyLedger.findFirst({
      where: { firmCode: FIRM, name: { equals: name, mode: 'insensitive' } },
      select: { name: true, parent: true, address: true, gstNo: true, panNo: true, mobileNos: true, state: true },
    })

    // 2. Outstanding bills (TallyOutstanding may be empty for KSI too, but
    // keep the call so the response shape doesn't break callers).
    const outstandingBills = await viDb.tallyOutstanding.findMany({
      where: { firmCode: FIRM, partyName: { equals: name, mode: 'insensitive' } },
      orderBy: { billDate: 'asc' },
    })

    // 3. Date window
    const where: any = { partyName: { equals: name, mode: 'insensitive' } }
    const fromDate = dateFrom ? new Date(dateFrom) : null
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = fromDate
      if (dateTo) where.date.lte = new Date(dateTo + 'T23:59:59.999Z')
    }

    // 4. Sales-side vouchers (Process Job / Sales / Credit Note / Debit
    // Note / Journal) from KsiSalesInvoice — the actual data source for KSI.
    const [salesVouchers, hdfcReceipts] = await Promise.all([
      db.ksiSalesInvoice.findMany({
        where,
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: {
          id: true, date: true, vchNumber: true, vchType: true,
          partyName: true, totalAmount: true, narration: true,
          isOpeningBalance: true,
          // Outstanding-side fields used downstream by the UI to detect
          // if a Journal is safely deletable (no linked receipt rows).
          allocations: { select: { id: true, allocatedAmount: true, receiptId: true } },
        },
      }),
      // Bank receipts (Receipt / Payment / Cash) from KsiHdfcReceipt.
      db.ksiHdfcReceipt.findMany({
        where: { ...where, hidden: false },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: {
          id: true, date: true, vchNumber: true, vchType: true,
          partyName: true, amount: true, narration: true, direction: true,
        },
      }),
    ])

    // 5. Normalise both sides into one timeline. Each row carries enough
    // info for the UI to render + the delete button to act on the right id.
    interface Row {
      source: 'sales' | 'hdfc'
      id: number
      date: string
      vchNumber: string | null
      vchType: string | null
      amount: number
      narration: string | null
      isOpeningBalance?: boolean
      allocationCount?: number
    }
    const rows: Row[] = []
    for (const s of salesVouchers) {
      if (EXCLUDE_TYPES.has(s.vchType)) continue
      rows.push({
        source: 'sales',
        id: s.id,
        date: s.date.toISOString(),
        vchNumber: s.vchNumber,
        vchType: s.vchType,
        amount: Number(s.totalAmount || 0),
        narration: s.narration,
        isOpeningBalance: s.isOpeningBalance,
        allocationCount: (s.allocations || []).length,
      })
    }
    for (const r of hdfcReceipts) {
      if (EXCLUDE_TYPES.has(r.vchType)) continue
      rows.push({
        source: 'hdfc',
        id: r.id,
        date: r.date.toISOString(),
        vchNumber: r.vchNumber,
        vchType: r.vchType,
        amount: Number(r.amount || 0),
        narration: r.narration,
      })
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

    // 6. Opening balance — Σ Dr − Σ Cr across every voucher dated
    // STRICTLY BEFORE dateFrom. Same DR/CR classification the UI uses
    // for in-range rows, so the running balance threads cleanly from
    // the OB row through to the closing total.
    let openingBalance = 0
    if (fromDate) {
      const [salesBefore, hdfcBefore] = await Promise.all([
        db.ksiSalesInvoice.findMany({
          where: { partyName: { equals: name, mode: 'insensitive' }, date: { lt: fromDate } },
          select: { vchType: true, totalAmount: true },
        }),
        db.ksiHdfcReceipt.findMany({
          where: { partyName: { equals: name, mode: 'insensitive' }, hidden: false, date: { lt: fromDate } },
          select: { vchType: true, amount: true },
        }),
      ])
      for (const s of salesBefore) {
        if (EXCLUDE_TYPES.has(s.vchType)) continue
        openingBalance += signedFor(s.vchType, Number(s.totalAmount || 0))
      }
      for (const r of hdfcBefore) {
        if (EXCLUDE_TYPES.has(r.vchType)) continue
        openingBalance += signedFor(r.vchType, Number(r.amount || 0))
      }
    }

    return NextResponse.json({ ledger, outstandingBills, vouchers: rows, openingBalance })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
