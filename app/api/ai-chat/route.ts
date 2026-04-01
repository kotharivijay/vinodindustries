import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`

// ─── Query Functions ───────────────────────────────────────────────────────

const db = prisma as any

const QUERY_FUNCTIONS: Record<string, (args: any) => Promise<any>> = {

  stock_summary: async () => {
    const greyByLot = await prisma.greyEntry.groupBy({ by: ['lotNo'], _sum: { than: true } })
    const despatchByLot = await prisma.despatchEntry.groupBy({ by: ['lotNo'], _sum: { than: true } })
    const despatchMap = new Map(despatchByLot.map(d => [d.lotNo, d._sum.than ?? 0]))

    let obList: any[] = []
    try { obList = await db.lotOpeningBalance.findMany() } catch {}
    const obMap = new Map(obList.map((o: any) => [o.lotNo.toLowerCase(), o]))

    const greyDetails = await prisma.greyEntry.findMany({
      select: { lotNo: true, party: { select: { name: true } } },
      distinct: ['lotNo'],
    })
    const lotPartyMap = new Map(greyDetails.map(g => [g.lotNo.toLowerCase(), g.party.name]))

    let totalStock = 0
    let totalLots = 0
    const partyTotals = new Map<string, number>()
    const processedLots = new Set<string>()

    for (const g of greyByLot) {
      const key = g.lotNo.toLowerCase()
      processedLots.add(key)
      const ob = obMap.get(key)
      const stock = (ob?.openingThan ?? 0) + (g._sum.than ?? 0) - (despatchMap.get(g.lotNo) ?? 0)
      if (stock <= 0) continue
      totalStock += stock
      totalLots++
      const party = lotPartyMap.get(key) ?? ob?.party ?? 'Unknown'
      partyTotals.set(party, (partyTotals.get(party) ?? 0) + stock)
    }

    for (const ob of obList) {
      const key = ob.lotNo.toLowerCase()
      if (processedLots.has(key)) continue
      let despThan = 0
      for (const [lotNo, than] of despatchMap) {
        if (lotNo.toLowerCase() === key) { despThan = than; break }
      }
      const stock = ob.openingThan - despThan
      if (stock <= 0) continue
      totalStock += stock
      totalLots++
      const party = ob.party || 'Unknown'
      partyTotals.set(party, (partyTotals.get(party) ?? 0) + stock)
    }

    const parties = Array.from(partyTotals.entries())
      .map(([name, stock]) => ({ name, stock }))
      .sort((a, b) => b.stock - a.stock)

    return { totalStock, totalLots, parties }
  },

  stock_by_party: async ({ party }: { party: string }) => {
    const greyEntries = await prisma.greyEntry.findMany({
      where: { party: { name: { contains: party, mode: 'insensitive' } } },
      select: { lotNo: true, than: true, party: { select: { name: true } }, quality: { select: { name: true } } },
    })

    if (greyEntries.length === 0) return { party, lots: [], message: 'No entries found for this party' }

    const lotMap = new Map<string, { lotNo: string; greyThan: number; party: string; quality: string }>()
    for (const g of greyEntries) {
      const key = g.lotNo.toLowerCase()
      const existing = lotMap.get(key)
      if (existing) {
        existing.greyThan += g.than
      } else {
        lotMap.set(key, { lotNo: g.lotNo, greyThan: g.than, party: g.party.name, quality: g.quality.name })
      }
    }

    const lotNos = [...new Set(greyEntries.map(g => g.lotNo))]
    const despatches = await prisma.despatchEntry.groupBy({
      by: ['lotNo'],
      where: { lotNo: { in: lotNos } },
      _sum: { than: true },
    })
    const despMap = new Map(despatches.map(d => [d.lotNo, d._sum.than ?? 0]))

    const lots = Array.from(lotMap.values()).map(l => ({
      ...l,
      despatchThan: despMap.get(l.lotNo) ?? 0,
      stock: l.greyThan - (despMap.get(l.lotNo) ?? 0),
    })).filter(l => l.stock > 0)

    const partyName = greyEntries[0]?.party?.name ?? party
    return { party: partyName, totalStock: lots.reduce((s, l) => s + l.stock, 0), lotCount: lots.length, lots }
  },

  stock_by_lot: async ({ lotNo }: { lotNo: string }) => {
    const greyEntries = await prisma.greyEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { party: true, quality: true },
    })
    const greyThan = greyEntries.reduce((s, g) => s + g.than, 0)

    const despatches = await prisma.despatchEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    })
    const despThan = despatches.reduce((s, d) => s + d.than, 0)

    let ob: any = null
    try { ob = await db.lotOpeningBalance.findUnique({ where: { lotNo } }) } catch {}

    const stock = (ob?.openingThan ?? 0) + greyThan - despThan
    return {
      lotNo,
      party: greyEntries[0]?.party?.name ?? ob?.party ?? 'Unknown',
      quality: greyEntries[0]?.quality?.name ?? ob?.quality ?? '-',
      greyThan,
      despatchThan: despThan,
      openingBalance: ob?.openingThan ?? 0,
      stock,
    }
  },

  lot_detail: async ({ lotNo }: { lotNo: string }) => {
    const grey = await prisma.greyEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { party: true, quality: true, weaver: true },
      orderBy: { date: 'desc' },
    })
    const despatch = await prisma.despatchEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { party: true },
      orderBy: { date: 'desc' },
    })
    const dyeing = await db.dyeingEntryLot.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { entry: { include: { machine: true, operator: true } } },
    })
    return {
      lotNo,
      greyEntries: grey.map(g => ({ date: g.date, challanNo: g.challanNo, party: g.party.name, quality: g.quality.name, than: g.than, weaver: g.weaver.name })),
      despatchEntries: despatch.map(d => ({ date: d.date, challanNo: d.challanNo, party: d.party.name, than: d.than, billNo: d.billNo })),
      dyeingEntries: dyeing.map((d: any) => ({ slipNo: d.entry.slipNo, date: d.entry.date, than: d.than, shade: d.entry.shadeName, machine: d.entry.machine?.name, operator: d.entry.operator?.name, status: d.entry.status })),
      greyThan: grey.reduce((s, g) => s + g.than, 0),
      despatchThan: despatch.reduce((s, d) => s + d.than, 0),
    }
  },

  dyeing_slips: async ({ dateFrom, dateTo, machine, operator, shade }: any) => {
    const where: any = {}
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); where.date.lte = d }
    }
    if (machine) where.machine = { name: { contains: machine, mode: 'insensitive' } }
    if (operator) where.operator = { name: { contains: operator, mode: 'insensitive' } }
    if (shade) where.shadeName = { contains: shade, mode: 'insensitive' }

    const entries = await db.dyeingEntry.findMany({
      where,
      include: { machine: true, operator: true, lots: true },
      orderBy: { date: 'desc' },
      take: 50,
    })

    return entries.map((e: any) => ({
      slipNo: e.slipNo,
      date: e.date,
      lotNo: e.lots?.length ? e.lots.map((l: any) => l.lotNo).join(', ') : e.lotNo,
      than: e.lots?.length ? e.lots.reduce((s: number, l: any) => s + l.than, 0) : e.than,
      shade: e.shadeName,
      machine: e.machine?.name,
      operator: e.operator?.name,
      status: e.status,
    }))
  },

  dyeing_summary: async ({ dateFrom, dateTo }: any) => {
    const where: any = {}
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); where.date.lte = d }
    }

    const entries = await db.dyeingEntry.findMany({ where, include: { lots: true } })
    let totalSlips = entries.length
    let totalThan = 0
    let doneCount = 0
    let patchyCount = 0
    let pendingCount = 0

    for (const e of entries) {
      const eThan = e.lots?.length ? e.lots.reduce((s: number, l: any) => s + l.than, 0) : e.than
      totalThan += eThan
      if (e.status === 'done' || e.dyeingDoneAt) doneCount++
      else if (e.status === 'patchy') patchyCount++
      else pendingCount++
    }

    return { totalSlips, totalThan, done: doneCount, patchy: patchyCount, pending: pendingCount, patchyRate: totalSlips > 0 ? ((patchyCount / totalSlips) * 100).toFixed(1) + '%' : '0%' }
  },

  grey_entries: async ({ party, dateFrom, dateTo, lotNo }: any) => {
    const where: any = {}
    if (party) where.party = { name: { contains: party, mode: 'insensitive' } }
    if (lotNo) where.lotNo = { equals: lotNo, mode: 'insensitive' }
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); where.date.lte = d }
    }

    const entries = await prisma.greyEntry.findMany({
      where,
      include: { party: true, quality: true, weaver: true },
      orderBy: { date: 'desc' },
      take: 50,
    })

    return entries.map(e => ({
      date: e.date, challanNo: e.challanNo, party: e.party.name, quality: e.quality.name,
      lotNo: e.lotNo, than: e.than, weaver: e.weaver.name,
    }))
  },

  despatch_entries: async ({ party, dateFrom, dateTo, lotNo }: any) => {
    const where: any = {}
    if (party) where.party = { name: { contains: party, mode: 'insensitive' } }
    if (lotNo) where.lotNo = { equals: lotNo, mode: 'insensitive' }
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); where.date.lte = d }
    }

    const entries = await prisma.despatchEntry.findMany({
      where,
      include: { party: true, quality: true },
      orderBy: { date: 'desc' },
      take: 50,
    })

    return entries.map(e => ({
      date: e.date, challanNo: e.challanNo, party: e.party.name, quality: e.quality.name,
      lotNo: e.lotNo, than: e.than, billNo: e.billNo, rate: e.rate,
    }))
  },

  shade_recipe: async ({ name }: { name: string }) => {
    const shade = await db.shade.findFirst({
      where: { name: { contains: name, mode: 'insensitive' } },
      include: { recipeItems: { include: { chemical: true } } },
    })
    if (!shade) return { message: 'Shade not found' }
    return {
      name: shade.name,
      description: shade.description,
      chemicals: shade.recipeItems.map((r: any) => ({
        chemical: r.chemical.name,
        quantity: r.quantity,
        isPercent: r.isPercent,
        unit: r.chemical.unit,
      })),
    }
  },

  outstanding: async ({ party }: any) => {
    const where: any = {}
    if (party) where.partyName = { contains: party, mode: 'insensitive' }

    const records = await db.tallyOutstanding.findMany({
      where,
      orderBy: { closingBalance: 'desc' },
      take: 50,
    })

    const grouped = new Map<string, { receivable: number; payable: number; bills: any[] }>()
    for (const r of records) {
      const key = r.partyName
      if (!grouped.has(key)) grouped.set(key, { receivable: 0, payable: 0, bills: [] })
      const g = grouped.get(key)!
      if (r.type === 'receivable') g.receivable += r.closingBalance
      else g.payable += r.closingBalance
      g.bills.push({ billRef: r.billRef, billDate: r.billDate, dueDate: r.dueDate, amount: r.closingBalance, type: r.type, overdueDays: r.overdueDays })
    }

    return Array.from(grouped.entries()).map(([name, data]) => ({
      party: name,
      netBalance: data.receivable - data.payable,
      receivable: data.receivable,
      payable: data.payable,
      bills: data.bills,
    }))
  },

  party_list: async () => {
    const parties = await prisma.party.findMany({ orderBy: { name: 'asc' } })
    return parties.map(p => p.name)
  },

  machine_production: async ({ dateFrom, dateTo }: any) => {
    const where: any = {}
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); where.date.lte = d }
    }
    where.machineId = { not: null }

    const entries = await db.dyeingEntry.findMany({
      where,
      include: { machine: true, lots: true },
    })

    const byMachine = new Map<string, { name: string; slips: number; than: number; done: number; patchy: number }>()
    for (const e of entries) {
      const name = e.machine?.name ?? 'Unknown'
      if (!byMachine.has(name)) byMachine.set(name, { name, slips: 0, than: 0, done: 0, patchy: 0 })
      const m = byMachine.get(name)!
      m.slips++
      m.than += e.lots?.length ? e.lots.reduce((s: number, l: any) => s + l.than, 0) : e.than
      if (e.status === 'done' || e.dyeingDoneAt) m.done++
      if (e.status === 'patchy') m.patchy++
    }

    return Array.from(byMachine.values())
  },

  operator_production: async ({ dateFrom, dateTo }: any) => {
    const where: any = {}
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); where.date.lte = d }
    }
    where.operatorId = { not: null }

    const entries = await db.dyeingEntry.findMany({
      where,
      include: { operator: true, lots: true },
    })

    const byOp = new Map<string, { name: string; slips: number; than: number; done: number; patchy: number }>()
    for (const e of entries) {
      const name = e.operator?.name ?? 'Unknown'
      if (!byOp.has(name)) byOp.set(name, { name, slips: 0, than: 0, done: 0, patchy: 0 })
      const o = byOp.get(name)!
      o.slips++
      o.than += e.lots?.length ? e.lots.reduce((s: number, l: any) => s + l.than, 0) : e.than
      if (e.status === 'done' || e.dyeingDoneAt) o.done++
      if (e.status === 'patchy') o.patchy++
    }

    return Array.from(byOp.values())
  },

  fold_available_lots: async ({ party, quality }: any) => {
    // Reuse stock API logic to get lots with foldAvailable > 0
    const foldBatchLots = await db.foldBatchLot.findMany({ select: { lotNo: true, than: true } })
    const foldMapLocal = new Map<string, number>()
    for (const fl of foldBatchLots) {
      const key = fl.lotNo.toLowerCase()
      foldMapLocal.set(key, (foldMapLocal.get(key) ?? 0) + fl.than)
    }

    const dyeingLots = await db.dyeingEntryLot.findMany({
      select: { lotNo: true, than: true, entry: { select: { foldBatchId: true } } },
    })
    const dyeingUsedMap = new Map<string, number>()
    for (const dl of dyeingLots) {
      if (dl.entry?.foldBatchId) continue
      const key = dl.lotNo.toLowerCase()
      dyeingUsedMap.set(key, (dyeingUsedMap.get(key) ?? 0) + dl.than)
    }

    const reservations = await db.lotManualReservation.findMany({
      select: { lotNo: true, usedThan: true },
    })
    const reservationMap = new Map<string, number>()
    for (const r of reservations) {
      reservationMap.set(r.lotNo.toLowerCase(), r.usedThan)
    }

    const greyByLot = await prisma.greyEntry.groupBy({ by: ['lotNo'], _sum: { than: true } })
    const despatchByLot = await prisma.despatchEntry.groupBy({ by: ['lotNo'], _sum: { than: true } })
    const despatchMap = new Map(despatchByLot.map(d => [d.lotNo, d._sum.than ?? 0]))

    let obList: any[] = []
    try { obList = await db.lotOpeningBalance.findMany() } catch {}
    const obMap = new Map(obList.map((o: any) => [o.lotNo.toLowerCase(), o]))

    const greyDetails = await prisma.greyEntry.findMany({
      select: { lotNo: true, party: { select: { name: true } }, quality: { select: { name: true } } },
      distinct: ['lotNo'],
    })
    const lotDetailMap = new Map(greyDetails.map(g => [g.lotNo.toLowerCase(), { party: g.party.name, quality: g.quality.name }]))

    const results: any[] = []
    const processedLots = new Set<string>()

    for (const g of greyByLot) {
      const key = g.lotNo.toLowerCase()
      processedLots.add(key)
      const ob = obMap.get(key)
      const stock = (ob?.openingThan ?? 0) + (g._sum.than ?? 0) - (despatchMap.get(g.lotNo) ?? 0)
      if (stock <= 0) continue
      const foldProgrammed = foldMapLocal.get(key) ?? 0
      const dyeingUsed = dyeingUsedMap.get(key) ?? 0
      const manuallyUsed = reservationMap.get(key) ?? 0
      const foldAvailable = Math.max(0, stock - foldProgrammed - manuallyUsed - dyeingUsed)
      if (foldAvailable <= 0) continue
      const detail = lotDetailMap.get(key)
      results.push({
        lotNo: g.lotNo,
        than: foldAvailable,
        quality: detail?.quality ?? ob?.quality ?? '-',
        party: detail?.party ?? ob?.party ?? 'Unknown',
        foldAvailable,
      })
    }

    for (const ob of obList) {
      const key = ob.lotNo.toLowerCase()
      if (processedLots.has(key)) continue
      let despThan = 0
      for (const [lotNo, than] of despatchMap) {
        if (lotNo.toLowerCase() === key) { despThan = than; break }
      }
      const stock = ob.openingThan - despThan
      if (stock <= 0) continue
      const foldProgrammed = foldMapLocal.get(key) ?? 0
      const dyeingUsed = dyeingUsedMap.get(key) ?? 0
      const manuallyUsed = reservationMap.get(key) ?? 0
      const foldAvailable = Math.max(0, stock - foldProgrammed - manuallyUsed - dyeingUsed)
      if (foldAvailable <= 0) continue
      results.push({
        lotNo: ob.lotNo,
        than: foldAvailable,
        quality: ob.quality || '-',
        party: ob.party || 'Unknown',
        foldAvailable,
      })
    }

    // Filter by party
    let filtered = results
    if (party) {
      const p = party.toLowerCase()
      filtered = filtered.filter((r: any) => r.party.toLowerCase().includes(p))
    }
    if (quality) {
      const q = quality.toLowerCase()
      filtered = filtered.filter((r: any) => r.quality.toLowerCase().includes(q))
    }

    return filtered.sort((a: any, b: any) => a.lotNo.localeCompare(b.lotNo))
  },

  create_fold: async ({ foldNo, date, batches }: any) => {
    // batches: [{ shadeId, shadeName, lots: [{ lotNo, than }] }]
    const program = await db.foldProgram.create({
      data: {
        foldNo: foldNo.trim(),
        date: new Date(date),
        status: 'draft',
        batches: {
          create: batches.map((batch: any, idx: number) => ({
            batchNo: idx + 1,
            shadeId: batch.shadeId || undefined,
            shadeName: batch.shadeName?.trim() || undefined,
            lots: {
              create: (batch.lots ?? []).map((lot: any) => ({
                lotNo: lot.lotNo.trim(),
                than: parseInt(lot.than) || 0,
              })),
            },
          })),
        },
      },
      include: {
        batches: {
          include: { shade: true, lots: true },
          orderBy: { batchNo: 'asc' },
        },
      },
    })
    return { foldNo: program.foldNo, date: program.date, batchCount: program.batches.length, totalThan: program.batches.reduce((s: number, b: any) => s + b.lots.reduce((s2: number, l: any) => s2 + l.than, 0), 0) }
  },

  fold_programs: async ({ status }: any) => {
    const where: any = {}
    if (status) where.status = status

    const programs = await db.foldProgram.findMany({
      where,
      include: {
        batches: {
          include: {
            shade: true,
            lots: { include: { party: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 20,
    })

    return programs.map((p: any) => ({
      foldNo: p.foldNo,
      date: p.date,
      status: p.status,
      batchCount: p.batches.length,
      totalThan: p.batches.reduce((s: number, b: any) => s + b.lots.reduce((s2: number, l: any) => s2 + l.than, 0), 0),
      batches: p.batches.map((b: any) => ({
        batchNo: b.batchNo,
        shade: b.shade?.name ?? b.shadeName ?? '-',
        lots: b.lots.map((l: any) => ({ lotNo: l.lotNo, than: l.than, party: l.party?.name })),
      })),
    }))
  },

  sales_data: async ({ party, dateFrom, dateTo }: any) => {
    const where: any = {}
    if (party) where.partyName = { contains: party, mode: 'insensitive' }
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = new Date(dateFrom)
      if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); where.date.lte = d }
    }

    const sales = await db.tallySales.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 50,
    })

    return sales.map((s: any) => ({
      date: s.date,
      vchNumber: s.vchNumber,
      party: s.partyName,
      item: s.itemName,
      quantity: s.quantity,
      rate: s.rate,
      amount: s.amount,
    }))
  },
}

// ─── Gemini API Call ───────────────────────────────────────────────────────

async function callGemini(systemPrompt: string, userMessage: string, history: { role: string; content: string }[]) {
  const contents = []

  // Add history
  for (const msg of history) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    })
  }

  // Add current user message
  contents.push({ role: 'user', parts: [{ text: userMessage }] })

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API error: ${res.status} ${errText}`)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ─── System Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI assistant for Kothari Synthetic Industries (KSI), a textile dyeing company based in India. Users will ask questions about their business data in Hindi or English. Be helpful, concise, and friendly.

Available functions to query data:
- stock_summary(): Get total stock across all parties with party-wise breakdown
- stock_by_lot(lotNo): Get stock for a specific lot number (e.g. "PS-885", "RD-120")
- stock_by_party(party): Get all lots and stock for a party name (partial match works)
- lot_detail(lotNo): Full detail of a lot — grey entries, despatch, dyeing history
- dyeing_slips(dateFrom?, dateTo?, machine?, operator?, shade?): Get dyeing entries (max 50)
- dyeing_summary(dateFrom?, dateTo?): Get dyeing stats — total slips, than, patchy rate
- grey_entries(party?, dateFrom?, dateTo?, lotNo?): Get grey inward entries
- despatch_entries(party?, dateFrom?, dateTo?, lotNo?): Get despatch entries
- shade_recipe(name): Get shade recipe with chemicals
- outstanding(party?): Get Tally outstanding balances
- party_list(): List all parties
- machine_production(dateFrom?, dateTo?): Production by machine
- operator_production(dateFrom?, dateTo?): Production by operator
- fold_programs(status?): List fold programs (status: draft/confirmed)
- fold_available_lots(party, quality?): Get available lots for fold creation filtered by party and quality
- create_fold(foldNo, date, batches): Create a new fold program
- sales_data(party?, dateFrom?, dateTo?): Tally sales data

FOLD CREATION RULES:
- When user wants to create a fold, call fold_available_lots first with the party name they mention
- Respond with: { "function": "fold_available_lots", "args": { "party": "...", "quality": "..." } }
- The UI will handle fold creation after showing lots — do NOT call create_fold directly

IMPORTANT RULES:
1. Respond ONLY with valid JSON. No markdown, no code fences, no explanation outside JSON.
2. If a data query is needed, respond with:
   { "function": "function_name", "args": { "key": "value" } }
3. If no query needed (greeting, general question, clarification):
   { "function": null, "text": "your response always in English" }
4. Dates must be YYYY-MM-DD format. Today is ${new Date().toISOString().slice(0, 10)}.
5. Use partial name matching for party names — user may say "Patel" meaning party whose name contains "Patel".
6. Lot numbers are typically like PS-885, RD-120, SS-50 etc.
7. "Than" is a unit of fabric measurement used in this business.
8. User may type in ANY language (Hindi, Hinglish, English). ALWAYS understand the intent and extract names/numbers correctly.
9. ALWAYS respond in English. Convert Hindi names to English: e.g. "प्रकाश शर्टिंग" → "Prakash Shirting", "मैजिक" → "Magic".
10. Party names, lot numbers, shade names — match them in English as stored in database.`

const FORMAT_PROMPT = `You are an AI assistant for Kothari Synthetic Industries (KSI), a textile dyeing company.
Format the following data into a clear, human-readable response. Use the same language as the user's original question.
Keep it concise but informative. Use numbers and bullet points where helpful.
If data is empty or shows no results, say so politely and suggest checking the spelling or trying a different query.
Do NOT use markdown formatting like ** or ## — just plain text with line breaks.
Respond in Hindi if the user asked in Hindi, otherwise English.`

// ─── App-side Result Formatter (no second Gemini call) ─────────────────────

function fmt(n: number): string { return n.toLocaleString('en-IN') }
function fmtINR(n: number): string { return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) }
function fmtDate(d: any): string { if (!d) return '-'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) }

function formatResult(fn: string, args: any, data: any): string {
  if (!data) return 'No data found.'

  switch (fn) {
    case 'stock_summary': {
      const d = data as { totalStock: number; totalLots: number; topParties: { party: string; stock: number }[] }
      let r = `Stock Summary\n\nTotal: ${fmt(d.totalStock)} than (${d.totalLots} lots)\n\nTop Parties:`
      for (const p of (d.topParties || []).slice(0, 10)) {
        r += `\n  ${p.party}: ${fmt(p.stock)} than`
      }
      return r
    }

    case 'stock_by_lot': {
      if (data.message) return data.message
      return `Lot: ${data.lotNo}\nParty: ${data.party}\nQuality: ${data.quality}\nGrey: ${fmt(data.greyThan)} than\nDespatched: ${fmt(data.despatchThan)} than\nBalance: ${fmt(data.stock)} than\nFold Available: ${fmt(data.foldAvailable)} than`
    }

    case 'stock_by_party': {
      if (!Array.isArray(data) || data.length === 0) return `No stock found for "${args.party}".`
      const total = data.reduce((s: number, l: any) => s + l.stock, 0)
      let r = `${data[0]?.party || args.party}\n${data.length} lots, ${fmt(total)} than total\n`
      for (const l of data.slice(0, 20)) {
        r += `\n  ${l.lotNo}: ${fmt(l.stock)} than (${l.quality})`
      }
      if (data.length > 20) r += `\n  ...and ${data.length - 20} more lots`
      return r
    }

    case 'lot_detail': {
      if (data.message) return data.message
      let r = `Lot ${data.lotNo}\nParty: ${data.party}\nQuality: ${data.quality}\nGrey: ${fmt(data.greyThan)} than\nDespatched: ${fmt(data.despatchThan)} than\nBalance: ${fmt(data.stock)} than`
      if (data.greyEntries?.length) {
        r += `\n\nGrey Entries:`
        for (const g of data.greyEntries.slice(0, 5)) {
          r += `\n  ${fmtDate(g.date)} - Challan ${g.challanNo}, ${g.than} than`
        }
      }
      if (data.despatchEntries?.length) {
        r += `\n\nDespatch:`
        for (const d of data.despatchEntries.slice(0, 5)) {
          r += `\n  ${fmtDate(d.date)} - Challan ${d.challanNo}, ${d.than} than`
        }
      }
      return r
    }

    case 'dyeing_summary': {
      const d = data as { totalSlips: number; totalThan: number; done: number; patchy: number; pending: number; totalCost: number }
      let r = `Dyeing Summary`
      if (args.dateFrom || args.dateTo) r += ` (${args.dateFrom || ''} to ${args.dateTo || 'today'})`
      r += `\n\nTotal Slips: ${d.totalSlips}\nTotal Than: ${fmt(d.totalThan)}`
      r += `\nDone: ${d.done} | Patchy: ${d.patchy} | Pending: ${d.pending}`
      if (d.totalSlips > 0) r += `\nPatchy Rate: ${((d.patchy / d.totalSlips) * 100).toFixed(1)}%`
      if (d.totalCost > 0) r += `\nTotal Cost: ${fmtINR(d.totalCost)}`
      return r
    }

    case 'dyeing_slips': {
      if (!Array.isArray(data) || data.length === 0) return 'No dyeing slips found for this filter.'
      let r = `Dyeing Slips: ${data.length} found\n`
      for (const e of data.slice(0, 15)) {
        r += `\n  Slip ${e.slipNo} | ${fmtDate(e.date)} | ${e.lotNo} | ${e.than}T`
        if (e.shade) r += ` | ${e.shade}`
        if (e.status && e.status !== 'pending') r += ` | ${e.status}`
      }
      if (data.length > 15) r += `\n  ...and ${data.length - 15} more`
      return r
    }

    case 'grey_entries': {
      if (!Array.isArray(data) || data.length === 0) return 'No grey entries found.'
      const total = data.reduce((s: number, e: any) => s + e.than, 0)
      let r = `Grey Entries: ${data.length} found, ${fmt(total)} than total\n`
      for (const e of data.slice(0, 15)) {
        r += `\n  ${fmtDate(e.date)} | Ch.${e.challanNo} | ${e.party} | ${e.lotNo} | ${e.than}T | ${e.quality}`
      }
      if (data.length > 15) r += `\n  ...and ${data.length - 15} more`
      return r
    }

    case 'despatch_entries': {
      if (!Array.isArray(data) || data.length === 0) return 'No despatch entries found.'
      const total = data.reduce((s: number, e: any) => s + e.than, 0)
      let r = `Despatch: ${data.length} entries, ${fmt(total)} than total\n`
      for (const e of data.slice(0, 15)) {
        r += `\n  ${fmtDate(e.date)} | Ch.${e.challanNo} | ${e.party} | ${e.lotNo} | ${e.than}T`
        if (e.billNo) r += ` | Bill: ${e.billNo}`
      }
      if (data.length > 15) r += `\n  ...and ${data.length - 15} more`
      return r
    }

    case 'shade_recipe': {
      if (data.message) return data.message
      let r = `Shade: ${data.name}`
      if (data.description) r += ` (${data.description})`
      if (data.chemicals?.length) {
        r += `\n\nRecipe (${data.chemicals.length} chemicals):`
        for (const c of data.chemicals) {
          r += `\n  ${c.chemical}: ${c.quantity}${c.isPercent ? '%' : ' ' + c.unit}`
        }
      } else {
        r += '\nNo recipe chemicals saved.'
      }
      return r
    }

    case 'outstanding': {
      if (!Array.isArray(data) || data.length === 0) return `No outstanding found${args.party ? ` for "${args.party}"` : ''}.`
      let r = 'Outstanding:\n'
      for (const p of data.slice(0, 10)) {
        r += `\n${p.party}`
        if (p.receivable > 0) r += `\n  Receivable: ${fmtINR(p.receivable)}`
        if (p.payable > 0) r += `\n  Payable: ${fmtINR(p.payable)}`
        r += `\n  ${p.bills.length} bill(s)`
      }
      if (data.length > 10) r += `\n\n...and ${data.length - 10} more parties`
      return r
    }

    case 'party_list': {
      if (!Array.isArray(data) || data.length === 0) return 'No parties found.'
      let r = `Parties: ${data.length} total\n`
      for (const p of data) {
        r += `\n  ${p.name}`
      }
      return r
    }

    case 'machine_production': {
      if (!Array.isArray(data) || data.length === 0) return 'No machine production data found.'
      let r = 'Machine Production:\n'
      for (const m of data) {
        r += `\n${m.name}: ${m.slips} slips, ${fmt(m.than)} than`
        r += ` | Done: ${m.done} | Patchy: ${m.patchy}`
        if (m.slips > 0) r += ` (${((m.patchy / m.slips) * 100).toFixed(0)}% patchy)`
      }
      return r
    }

    case 'operator_production': {
      if (!Array.isArray(data) || data.length === 0) return 'No operator production data found.'
      let r = 'Operator Production:\n'
      for (const o of data) {
        r += `\n${o.name}: ${o.slips} slips, ${fmt(o.than)} than`
        r += ` | Done: ${o.done} | Patchy: ${o.patchy}`
        if (o.slips > 0) r += ` (${((o.patchy / o.slips) * 100).toFixed(0)}% patchy)`
      }
      return r
    }

    case 'fold_programs': {
      if (!Array.isArray(data) || data.length === 0) return 'No fold programs found.'
      let r = `Fold Programs: ${data.length} found\n`
      for (const f of data.slice(0, 10)) {
        r += `\nFold ${f.foldNo} | ${fmtDate(f.date)} | ${f.status} | ${f.batchCount} batch(es), ${fmt(f.totalThan)} than`
      }
      return r
    }

    case 'sales_data': {
      if (!Array.isArray(data) || data.length === 0) return 'No sales data found.'
      const total = data.reduce((s: number, e: any) => s + (e.amount || 0), 0)
      let r = `Sales: ${data.length} entries, Total: ${fmtINR(total)}\n`
      for (const s of data.slice(0, 10)) {
        r += `\n  ${fmtDate(s.date)} | ${s.party} | ${s.item || '-'} | ${fmtINR(s.amount || 0)}`
      }
      if (data.length > 10) r += `\n  ...and ${data.length - 10} more`
      return r
    }

    default:
      return JSON.stringify(data, null, 2).slice(0, 2000)
  }
}

// ─── POST Handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { message, history = [] } = await req.json()
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })
    }

    // Step 1: Ask Gemini what function to call
    const step1Response = await callGemini(SYSTEM_PROMPT, message, history)

    let parsed: any
    try {
      // Strip any markdown code fences if present
      const cleaned = step1Response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      // If Gemini didn't return valid JSON, treat as direct text response
      return NextResponse.json({ reply: step1Response })
    }

    // Step 2: If no function needed, return direct text
    if (!parsed.function) {
      return NextResponse.json({ reply: parsed.text || 'I can help you with business data queries. Try asking about stock, dyeing, or outstanding!' })
    }

    // Step 3: Execute the query function
    const fn = QUERY_FUNCTIONS[parsed.function]
    if (!fn) {
      return NextResponse.json({ reply: `Sorry, I don't know how to handle "${parsed.function}". Try asking about stock, dyeing slips, outstanding, or shade recipes.` })
    }

    let data: any
    try {
      data = await fn(parsed.args || {})
    } catch (queryErr: any) {
      console.error('Query execution error:', queryErr)
      return NextResponse.json({ reply: 'Sorry, there was an error running the database query. Please try again or rephrase your question.' })
    }

    // Special handling for fold_available_lots — return raw data for UI
    if (parsed.function === 'fold_available_lots') {
      return NextResponse.json({
        reply: data.length > 0
          ? `Found ${data.length} lots available for fold creation. Select lots below to create a fold program.`
          : 'No lots with available stock found for this party. Try a different party name.',
        action: 'fold_create',
        lots: data,
      })
    }

    // Step 4: Format result in app (no second Gemini call!)
    const reply = formatResult(parsed.function, parsed.args, data)
    return NextResponse.json({ reply })
  } catch (err: any) {
    console.error('AI Chat error:', err?.message, err?.stack)
    return NextResponse.json({ reply: `Error: ${err?.message || 'Something went wrong. Please try again.'}` })
  }
}
