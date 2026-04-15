export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dateFrom = req.nextUrl.searchParams.get('from')
  const dateTo = req.nextUrl.searchParams.get('to')
  if (!dateFrom || !dateTo) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const from = new Date(dateFrom)
  const to = new Date(dateTo)
  to.setHours(23, 59, 59, 999)

  const db = prisma as any

  // Get all dyeing entries in range with chemicals
  const entries = await db.dyeingEntry.findMany({
    where: { date: { gte: from, lte: to } },
    include: {
      chemicals: true,
      lots: true,
      additions: { include: { chemicals: true } },
    },
  })

  const totalBatches = entries.length
  const totalThan = entries.reduce((s: number, e: any) => {
    const lots = e.lots?.length ? e.lots : [{ than: e.than }]
    return s + lots.reduce((ls: number, l: any) => ls + l.than, 0)
  }, 0)

  // Aggregate chemicals: round 1 + additions
  const chemMap = new Map<string, { name: string; unit: string; consumed: number; rate: number; cost: number; processTag: string | null; chemicalId: number | null }>()

  for (const e of entries) {
    // Round 1 chemicals
    for (const c of (e.chemicals || [])) {
      const key = c.name.toLowerCase().trim()
      if (!chemMap.has(key)) chemMap.set(key, { name: c.name, unit: c.unit, consumed: 0, rate: c.rate || 0, cost: 0, processTag: c.processTag, chemicalId: c.chemicalId })
      const item = chemMap.get(key)!
      item.consumed += c.quantity || 0
      item.cost += c.cost || 0
      if (c.rate && c.rate > 0) item.rate = c.rate
    }

    // Addition chemicals
    for (const a of (e.additions || [])) {
      for (const c of (a.chemicals || [])) {
        const key = (c.name || c.chemical?.name || '').toLowerCase().trim()
        if (!key) continue
        const name = c.name || c.chemical?.name || key
        if (!chemMap.has(key)) chemMap.set(key, { name, unit: c.unit || 'kg', consumed: 0, rate: 0, cost: 0, processTag: null, chemicalId: c.chemicalId })
        const item = chemMap.get(key)!
        item.consumed += c.quantity || 0
        item.cost += (c.quantity || 0) * item.rate
      }
    }
  }

  // Split into dyes and auxiliary
  const dyes: any[] = []
  const auxiliary: any[] = []

  for (const item of chemMap.values()) {
    const entry = {
      name: item.name,
      unit: item.unit,
      consumed: Math.round(item.consumed * 1000) / 1000,
      rate: item.rate,
      cost: Math.round(item.cost),
    }
    if (item.processTag === 'shade') dyes.push(entry)
    else auxiliary.push(entry)
  }

  dyes.sort((a, b) => b.cost - a.cost)
  auxiliary.sort((a, b) => b.cost - a.cost)

  const dyeTotal = dyes.reduce((s, d) => s + d.cost, 0)
  const auxTotal = auxiliary.reduce((s, a) => s + a.cost, 0)

  return NextResponse.json({
    totalBatches,
    totalThan,
    dyes,
    auxiliary,
    dyeTotal,
    auxTotal,
    grandTotal: dyeTotal + auxTotal,
  })
}
