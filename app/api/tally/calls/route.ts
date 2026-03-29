import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const p = req.nextUrl.searchParams
  const firm = p.get('firm') || ''
  const priority = p.get('priority') || ''
  const search = p.get('search') || ''

  const db = viPrisma as any
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Get outstanding grouped by party
  const osWhere: any = {}
  if (firm) osWhere.firmCode = firm
  const osBills = await db.tallyOutstanding.findMany({ where: osWhere, select: { partyName: true, firmCode: true, closingBalance: true, overdueDays: true, type: true } })

  // Group by party
  const partyMap: Record<string, { totalOS: number; billCount: number; maxAge: number; firms: Set<string>; type: string }> = {}
  for (const b of osBills) {
    if (!b.partyName) continue
    const key = b.partyName.toLowerCase().trim()
    if (!partyMap[key]) partyMap[key] = { totalOS: 0, billCount: 0, maxAge: 0, firms: new Set(), type: b.type || 'receivable' }
    const amt = Math.abs(b.closingBalance || 0)
    partyMap[key].totalOS += amt
    partyMap[key].billCount++
    partyMap[key].maxAge = Math.max(partyMap[key].maxAge, b.overdueDays || 0)
    partyMap[key].firms.add(b.firmCode)
  }

  // Get contacts for mobile numbers
  const contacts = await db.contact.findMany({ select: { name: true, mobile1: true, firmCode: true, agentName: true } })
  const contactMap: Record<string, { mobile: string; agent: string }> = {}
  for (const c of contacts) {
    if (c.name) contactMap[c.name.toLowerCase().trim()] = { mobile: c.mobile1 || '', agent: c.agentName || '' }
  }

  // Get last call per party
  const callLogs = await db.callLog.findMany({ orderBy: { callDate: 'desc' } })
  const callMap: Record<string, any> = {}
  for (const cl of callLogs) {
    const key = cl.partyName.toLowerCase().trim()
    if (!callMap[key]) {
      const daysSince = Math.floor((today.getTime() - new Date(cl.callDate).getTime()) / 86400000)
      const promiseBroken = cl.promiseDate && new Date(cl.promiseDate) < today && partyMap[key]?.totalOS > 0
      const followUpDue = cl.nextFollowUp && new Date(cl.nextFollowUp) <= today
      callMap[key] = {
        lastCallDate: cl.callDate,
        lastNote: cl.note || '',
        daysSince,
        promiseDate: cl.promiseDate,
        promiseAmt: cl.promiseAmt || 0,
        promiseBroken: !!promiseBroken,
        nextFollowUp: cl.nextFollowUp,
        followUpDue: !!followUpDue,
      }
    }
  }

  // Get payment behavior
  const payments = await db.bankPayment.findMany({ where: { deposit: { gt: 0 } }, select: { partyName: true, paymentDays: true } })
  const payMap: Record<string, { totalDays: number; count: number }> = {}
  for (const pay of payments) {
    if (!pay.partyName || !pay.paymentDays) continue
    const key = pay.partyName.toLowerCase().trim()
    if (!payMap[key]) payMap[key] = { totalDays: 0, count: 0 }
    payMap[key].totalDays += pay.paymentDays
    payMap[key].count++
  }

  // Build result
  const parties: any[] = []
  for (const [key, p] of Object.entries(partyMap)) {
    if (p.totalOS < 100) continue // skip tiny amounts

    const contact = contactMap[key]
    const call = callMap[key]
    const pay = payMap[key]
    const avgDays = pay ? Math.round(pay.totalDays / pay.count) : 0
    const payTag = !pay ? 'never' : pay.count < 3 ? 'new' : avgDays < 15 ? 'fast' : avgDays < 30 ? 'normal' : avgDays < 60 ? 'slow' : 'very_slow'
    const payLabel = { never: 'Never Paid', new: 'New Party', fast: 'Fast Payer', normal: 'Normal', slow: 'Slow Payer', very_slow: 'Very Slow' }[payTag] || ''

    // Priority score
    const sOS = Math.min(30, Math.round(p.totalOS / 10000))
    const sAge = Math.min(20, Math.round(p.maxAge / 5))
    const sCall = call === undefined ? 20 : call.daysSince >= 30 ? 18 : call.daysSince >= 14 ? 14 : call.daysSince >= 7 ? 10 : call.daysSince >= 3 ? 5 : 0
    const sPromise = call?.promiseBroken ? 15 : 0
    const sPay = payTag === 'never' ? 10 : payTag === 'very_slow' ? 8 : payTag === 'slow' ? 5 : 0
    const score = sOS + sAge + sCall + sPromise + sPay
    const pri = score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low'

    // Search filter
    if (search) {
      const origName = osBills.find((b: any) => b.partyName?.toLowerCase().trim() === key)?.partyName || key
      if (!origName.toLowerCase().includes(search.toLowerCase())) continue
    }

    // Priority filter
    if (priority === 'critical' && pri !== 'critical') continue
    if (priority === 'high' && pri !== 'high') continue
    if (priority === 'never' && call !== undefined) continue
    if (priority === 'promise' && !call?.promiseBroken) continue
    if (priority === 'followup' && !call?.followUpDue) continue

    const origName = osBills.find((b: any) => b.partyName?.toLowerCase().trim() === key)?.partyName || key
    parties.push({
      partyName: origName,
      totalOS: Math.round(p.totalOS),
      billCount: p.billCount,
      maxAge: p.maxAge,
      firms: [...p.firms],
      score,
      priority: pri,
      mobile: contact?.mobile || '',
      agentName: contact?.agent || '',
      payTag,
      payLabel,
      payAvgDays: avgDays,
      lastCallDate: call?.lastCallDate || null,
      lastNote: call?.lastNote || '',
      daysSince: call?.daysSince ?? null,
      promiseDate: call?.promiseDate || null,
      promiseAmt: call?.promiseAmt || 0,
      promiseBroken: call?.promiseBroken || false,
      nextFollowUp: call?.nextFollowUp || null,
      followUpDue: call?.followUpDue || false,
    })
  }

  // Sort by priority score desc, then OS desc
  parties.sort((a, b) => {
    const sa = a.promiseBroken ? 0 : a.followUpDue ? 1 : a.daysSince === null ? 2 : a.daysSince >= 30 ? 3 : a.daysSince >= 14 ? 4 : 5
    const sb = b.promiseBroken ? 0 : b.followUpDue ? 1 : b.daysSince === null ? 2 : b.daysSince >= 30 ? 3 : b.daysSince >= 14 ? 4 : 5
    if (sa !== sb) return sa - sb
    return b.totalOS - a.totalOS
  })

  const summary = {
    total: parties.length,
    neverCalled: parties.filter(p => p.daysSince === null).length,
    promiseBroken: parties.filter(p => p.promiseBroken).length,
    followUpDue: parties.filter(p => p.followUpDue).length,
    atRisk: parties.filter(p => p.priority === 'critical' || p.priority === 'high').length,
    grandOS: parties.reduce((s, p) => s + p.totalOS, 0),
  }

  return NextResponse.json({ parties, summary })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const db = viPrisma as any

  const entry = await db.callLog.create({
    data: {
      partyName: body.party || '',
      firmCode: body.firm || null,
      callDate: new Date(),
      note: body.note || null,
      promiseDate: body.promiseDate ? new Date(body.promiseDate) : null,
      promiseAmt: parseFloat(body.promiseAmt) || null,
      nextFollowUp: body.nextFollowUpDays ? new Date(Date.now() + parseInt(body.nextFollowUpDays) * 86400000) : null,
      calledBy: session.user?.email || null,
    },
  })

  return NextResponse.json({ success: true, id: entry.id })
}
