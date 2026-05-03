export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCurrentFy } from '@/lib/inv/series'
import { resolvePartyIdByLedger } from '@/lib/inv/party-resolver'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const partyId = sp.get('partyId')
  const where: any = {}
  if (status) where.status = status
  if (partyId) where.partyId = Number(partyId)

  const pos = await db.invPO.findMany({
    where,
    include: { party: { select: { id: true, displayName: true } }, lines: true },
    orderBy: { poDate: 'desc' },
    take: 200,
  })
  return NextResponse.json(pos)
}

async function generatePoNo(): Promise<string> {
  const fy = getCurrentFy() // '2026-27'
  const fyShort = fy.replace('-', '-') // keep as-is
  const last = await db.invPO.findFirst({
    where: { poNo: { startsWith: `KSI/PO/${fyShort}/` } },
    orderBy: { poNo: 'desc' },
    select: { poNo: true },
  })
  let next = 1
  if (last) {
    const m = last.poNo.match(/(\d+)$/)
    if (m) next = parseInt(m[1], 10) + 1
  }
  return `KSI/PO/${fyShort}/${String(next).padStart(4, '0')}`
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { partyId: rawPartyId, tallyLedger, poNo, poDate, expectedDate, terms, notes, defaultDiscountPct, lines } = body
  if ((!rawPartyId && !tallyLedger) || !poDate || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: '(partyId or tallyLedger), poDate, lines required' }, { status: 400 })
  }

  // Resolve ledger name → InvParty.id (find-or-create) when caller sends tallyLedger
  let partyId: number
  if (rawPartyId) partyId = Number(rawPartyId)
  else partyId = await resolvePartyIdByLedger(String(tallyLedger))

  const finalPoNo = poNo?.trim() || await generatePoNo()

  let totalAmount = 0
  const lineRows = lines.map((l: any, i: number) => {
    const qty = Number(l.qty || 0)
    const rate = Number(l.rate || 0)
    const amount = qty * rate
    totalAmount += amount
    return {
      lineNo: i + 1,
      itemId: Number(l.itemId),
      qty, unit: l.unit, rate, amount,
      discountType: l.discountType || null,
      discountValue: l.discountValue != null ? Number(l.discountValue) : null,
      discountAmount: l.discountAmount != null ? Number(l.discountAmount) : null,
      remarks: l.remarks || null,
    }
  })

  const po = await db.invPO.create({
    data: {
      partyId,
      poNo: finalPoNo,
      poDate: new Date(poDate),
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      terms: terms || null,
      notes: notes || null,
      defaultDiscountPct: defaultDiscountPct != null ? Number(defaultDiscountPct) : null,
      totalAmount,
      lines: { create: lineRows },
    },
    include: { lines: true, party: true },
  })
  return NextResponse.json(po)
}
