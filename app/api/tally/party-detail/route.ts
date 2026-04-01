import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const norm = (s: string) => s.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase()

function wordOverlap(a: string, b: string): number {
  const wa = norm(a).replace(/[.,&\-()'"\/\\]/g, ' ').split(/\s+/).filter(Boolean)
  const wb = norm(b).replace(/[.,&\-()'"\/\\]/g, ' ').split(/\s+/).filter(Boolean)
  if (!wa.length || !wb.length) return 0
  const setB = new Set(wb)
  const matched = wa.filter(w => setB.has(w)).length
  return matched / Math.max(wa.length, wb.length)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const name = req.nextUrl.searchParams.get('name') || ''
  const agent = req.nextUrl.searchParams.get('agent') || ''
  const db = viPrisma as any

  // ── AGENT MODE ──
  if (agent) {
    // Find agent ledger
    const agentLedger = await db.tallyLedger.findFirst({
      where: { name: { equals: agent, mode: 'insensitive' } },
      select: { name: true, mobileNo1: true, mobileNo2: true, address: true, firmCode: true },
    })

    // Find all parties under this agent (parent = agent name)
    const partyLedgers = await db.tallyLedger.findMany({
      where: { parent: { contains: agent, mode: 'insensitive' } },
      select: { name: true },
    })
    const partyNames = partyLedgers.map((l: any) => l.name)
    const partyNormSet = new Set(partyNames.map(norm))

    // Outstanding
    const allOS = await db.tallyOutstanding.findMany({ take: 10000 })
    const partyMap: Record<string, { bills: any[]; total: number }> = {}
    let grandTotal = 0, totalBills = 0
    for (const b of allOS) {
      const pn = (b.partyName || '').trim()
      if (!partyNormSet.has(norm(pn))) continue
      if (!partyMap[pn]) partyMap[pn] = { bills: [], total: 0 }
      partyMap[pn].bills.push({ billRef: b.billRef, billDate: b.billDate, amount: Math.abs(b.closingBalance || 0), overdueDays: b.overdueDays || 0, firmCode: b.firmCode })
      partyMap[pn].total += Math.abs(b.closingBalance || 0)
      grandTotal += Math.abs(b.closingBalance || 0)
      totalBills++
    }
    const parties = Object.entries(partyMap).map(([n, v]) => ({ name: n, ...v })).sort((a, b) => b.total - a.total)

    // Agent sales
    const salesAgg = await db.tallySales.aggregate({
      where: { partyName: { in: partyNames } },
      _sum: { amount: true },
      _count: true,
    })

    // Pending orders
    const pendingOrders = await db.salesOrder.aggregate({
      where: { agentName: { contains: agent.split(' ')[0], mode: 'insensitive' }, status: 'Pending' },
      _sum: { balance: true },
      _count: true,
    })

    return NextResponse.json({
      mode: 'agent',
      ledger: agentLedger,
      totalParties: partyNames.length,
      parties,
      grandTotal: Math.round(grandTotal),
      totalBills,
      totalSales: salesAgg._sum?.amount || 0,
      salesCount: salesAgg._count || 0,
      pendingOrders: { count: pendingOrders._count || 0, balanceQty: pendingOrders._sum?.balance || 0 },
    })
  }

  // ── PARTY MODE ──
  if (!name) return NextResponse.json({ error: 'name or agent required' }, { status: 400 })

  // Find matching Tally ledger (exact then fuzzy)
  let ledger = await db.tallyLedger.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  })

  let nameMatch: any = { exact: true, tallyName: name, score: 1 }
  if (!ledger) {
    // Fuzzy search
    const allLedgers = await db.tallyLedger.findMany({ select: { name: true, id: true }, take: 15000 })
    let bestScore = 0, bestName = ''
    for (const l of allLedgers) {
      const score = wordOverlap(name, l.name)
      if (score > bestScore) { bestScore = score; bestName = l.name }
    }
    if (bestScore >= 0.6) {
      ledger = await db.tallyLedger.findFirst({ where: { name: bestName } })
      nameMatch = { exact: false, tallyName: bestName, score: Math.round(bestScore * 100) }
    } else {
      nameMatch = { exact: false, tallyName: null, score: 0 }
    }
  }

  // Contact
  const contact = await db.contact.findFirst({
    where: { name: { contains: name.split(' ').slice(0, 2).join(' '), mode: 'insensitive' } },
    select: { mobile1: true, mobile2: true, mobile3: true, contactPerson: true, agentName: true, tag: true },
  })

  // Outstanding bills
  const searchName = ledger?.name || name
  const osBills = await db.tallyOutstanding.findMany({
    where: { partyName: { equals: searchName, mode: 'insensitive' } },
    orderBy: { overdueDays: 'desc' },
  })
  const osTotal = osBills.reduce((s: number, b: any) => s + Math.abs(b.closingBalance || 0), 0)
  const osOldest = osBills.length ? Math.max(...osBills.map((b: any) => b.overdueDays || 0)) : 0

  // Bank payments
  const bankPayments = await db.bankPayment.findMany({
    where: { partyName: { contains: searchName.split(' ').slice(0, 2).join(' '), mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: 20,
  })
  const payDays = bankPayments.filter((p: any) => p.paymentDays && p.paymentDays > 0)
  const avgDays = payDays.length ? Math.round(payDays.reduce((s: number, p: any) => s + p.paymentDays, 0) / payDays.length) : 0
  const payerTag = !payDays.length ? 'Never Paid' : avgDays < 15 ? 'Fast Payer' : avgDays < 30 ? 'Normal' : avgDays < 60 ? 'Slow Payer' : 'Very Slow'

  // Performance
  const salesAgg = await db.tallySales.aggregate({
    where: { partyName: { equals: searchName, mode: 'insensitive' } },
    _sum: { amount: true },
    _count: true,
  })
  const monthlySales = await db.tallySales.groupBy({
    by: ['date'],
    where: { partyName: { equals: searchName, mode: 'insensitive' }, date: { not: null } },
    _sum: { amount: true },
  })
  // Group by month
  const monthMap: Record<string, number> = {}
  const monthNames = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
  for (const m of monthlySales) {
    if (!m.date) continue
    const d = new Date(m.date)
    const key = monthNames[((d.getMonth() + 9) % 12)] // FY month order
    monthMap[key] = (monthMap[key] || 0) + Math.abs(m._sum?.amount || 0)
  }

  // Top items
  const topItems = await db.tallySales.groupBy({
    by: ['itemName'],
    where: { partyName: { equals: searchName, mode: 'insensitive' }, itemName: { not: null } },
    _sum: { amount: true, quantity: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: 5,
  })

  // Recent sales
  const recentSales = await db.tallySales.findMany({
    where: { partyName: { equals: searchName, mode: 'insensitive' } },
    orderBy: { date: 'desc' },
    take: 15,
  })

  // Aging buckets
  const aging = { d30: 0, d60: 0, d90: 0, d90plus: 0 }
  for (const b of osBills) {
    const days = b.overdueDays || 0
    const amt = Math.abs(b.closingBalance || 0)
    if (days <= 30) aging.d30 += amt
    else if (days <= 60) aging.d60 += amt
    else if (days <= 90) aging.d90 += amt
    else aging.d90plus += amt
  }

  // Score
  const sOverdue = osTotal > 0 ? Math.min(30, Math.round((aging.d90plus / osTotal) * 30)) : 0
  const sAge = Math.min(20, Math.round(osOldest / 5))
  const sPay = payerTag === 'Never Paid' ? 10 : payerTag === 'Very Slow' ? 8 : payerTag === 'Slow Payer' ? 5 : 0
  const sVolume = Math.min(20, Math.round((salesAgg._sum?.amount || 0) / 100000))
  const score = Math.max(0, 100 - sOverdue - sAge - sPay + sVolume)

  // Orders for this party
  const partyOrders = await db.salesOrder.findMany({
    where: { partyName: { contains: name.split(' ').slice(0, 2).join(' '), mode: 'insensitive' } },
    orderBy: { id: 'desc' },
    take: 10,
  })

  return NextResponse.json({
    mode: 'party',
    nameMatch,
    ledger: ledger ? { name: ledger.name, address: ledger.address, gstNo: ledger.gstNo, panNo: ledger.panNo, mobileNo1: ledger.mobileNo1, mobileNo2: ledger.mobileNo2, state: ledger.state, parent: ledger.parent, firmCode: ledger.firmCode } : null,
    contact,
    outstanding: { total: Math.round(osTotal), oldest: osOldest, count: osBills.length, bills: osBills.map((b: any) => ({ billRef: b.billRef, billDate: b.billDate, amount: Math.abs(Math.round(b.closingBalance || 0)), overdueDays: b.overdueDays || 0, firmCode: b.firmCode })) },
    aging,
    bankPayments: { avgDays, payerTag, payments: bankPayments.map((p: any) => ({ date: p.voucherDate, description: p.description, partyName: p.partyName, deposit: p.deposit, narration: p.narration, paymentDays: p.paymentDays })) },
    performance: { score, totalSales: salesAgg._sum?.amount || 0, salesCount: salesAgg._count || 0, avgBill: salesAgg._count ? Math.round((salesAgg._sum?.amount || 0) / salesAgg._count) : 0, monthlySales: monthMap, topItems: topItems.map((t: any) => ({ item: t.itemName, amount: t._sum?.amount || 0, qty: t._sum?.quantity || 0 })) },
    recentSales: recentSales.map((s: any) => ({ date: s.date, vchNumber: s.vchNumber, partyName: s.partyName, itemName: s.itemName, quantity: s.quantity, rate: s.rate, amount: s.amount })),
    orders: partyOrders,
  })
}

// POST — update party/agent name in orders
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { oldName, newName, field } = await req.json()
  if (!oldName || !newName || !field) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const db = viPrisma as any
  if (field === 'party') {
    const result = await db.salesOrder.updateMany({ where: { partyName: oldName }, data: { partyName: newName } })
    return NextResponse.json({ updated: result.count })
  }
  if (field === 'agent') {
    const result = await db.salesOrder.updateMany({ where: { agentName: oldName }, data: { agentName: newName } })
    return NextResponse.json({ updated: result.count })
  }
  return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
}
