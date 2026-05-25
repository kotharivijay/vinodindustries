export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Bulk-create manual opening-balance invoices for a single party.
 * Body:
 *   {
 *     partyName: string,
 *     fy:        string,           // e.g. "24-25"
 *     vchType?:  string,           // default "Process Job"
 *     openingAmount: number,       // sum users expects to match
 *     invoices: [{ date: 'YYYY-MM-DD', vchNumber: string, amount: number }]
 *   }
 * Validates sum(invoices.amount) === openingAmount (±1 paisa).
 * Marks each row isOpeningBalance=true so ksi-sales-sync skips them later.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const partyName = String(body.partyName || '').trim()
  const fy = String(body.fy || '').trim()
  const vchType = String(body.vchType || 'Process Job').trim()
  const openingAmount = Number(body.openingAmount)
  const invoices: Array<{ date: string; vchNumber: string; amount: number }> = Array.isArray(body.invoices) ? body.invoices : []

  if (!partyName) return NextResponse.json({ error: 'partyName required' }, { status: 400 })
  if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 })
  if (!Number.isFinite(openingAmount)) return NextResponse.json({ error: 'openingAmount must be a number' }, { status: 400 })
  if (invoices.length === 0) return NextResponse.json({ error: 'At least one invoice row required' }, { status: 400 })

  // Validate every row + total.
  const cleaned: Array<{ date: Date; vchNumber: string; amount: number }> = []
  let sum = 0
  for (let i = 0; i < invoices.length; i++) {
    const r = invoices[i]
    if (!r || !r.date || !r.vchNumber) {
      return NextResponse.json({ error: `Row ${i + 1}: date and invoice number required` }, { status: 400 })
    }
    const d = new Date(r.date)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: `Row ${i + 1}: bad date "${r.date}"` }, { status: 400 })
    }
    const amt = Number(r.amount)
    if (!Number.isFinite(amt)) {
      return NextResponse.json({ error: `Row ${i + 1}: bad amount` }, { status: 400 })
    }
    cleaned.push({ date: d, vchNumber: String(r.vchNumber).trim(), amount: amt })
    sum += amt
  }
  const delta = Math.abs(sum - openingAmount)
  if (delta > 0.01) {
    return NextResponse.json({
      error: `Sum of rows (${sum.toFixed(2)}) ≠ opening amount (${openingAmount.toFixed(2)}). Δ ${delta.toFixed(2)}.`,
    }, { status: 400 })
  }

  // Refuse duplicates on the same natural key (vchNumber + date + vchType).
  // Pre-flight check so we don't half-insert and stop on a P2002.
  const naturalKeys = cleaned.map(r => `${r.vchNumber}::${r.date.toISOString().slice(0, 10)}::${vchType}`)
  const existing = await db.ksiSalesInvoice.findMany({
    where: {
      vchType,
      OR: cleaned.map(r => ({ vchNumber: r.vchNumber, date: r.date })),
    },
    select: { vchNumber: true, date: true },
  })
  if (existing.length > 0) {
    const dup = existing.map((e: any) => `${e.vchNumber} (${e.date.toISOString().slice(0, 10)})`).join(', ')
    return NextResponse.json({ error: `Duplicate invoices already exist: ${dup}` }, { status: 409 })
  }
  void naturalKeys

  // All good — bulk insert in one transaction.
  const created = await db.$transaction(
    cleaned.map(r => db.ksiSalesInvoice.create({
      data: {
        fy,
        date: r.date,
        vchNumber: r.vchNumber,
        vchType,
        partyName,
        totalAmount: r.amount,
        isOpeningBalance: true,
        narration: `Manual opening balance (FY ${fy})`,
      },
      select: { id: true, vchNumber: true, totalAmount: true },
    })),
  )

  return NextResponse.json({ ok: true, created: created.length, ids: created.map((c: any) => c.id) }, { status: 201 })
}
