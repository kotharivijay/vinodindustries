import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`

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
- sales_data(party?, dateFrom?, dateTo?): Tally sales data

IMPORTANT RULES:
1. Respond ONLY with valid JSON. No markdown, no code fences, no explanation outside JSON.
2. If a data query is needed, respond with:
   { "function": "function_name", "args": { "key": "value" } }
3. If no query needed (greeting, general question, clarification):
   { "function": null, "text": "your response in same language as user" }
4. Dates must be YYYY-MM-DD format. Today is ${new Date().toISOString().slice(0, 10)}.
5. Use partial name matching for party names — user may say "Patel" meaning party whose name contains "Patel".
6. Lot numbers are typically like PS-885, RD-120, SS-50 etc.
7. "Than" is a unit of fabric measurement used in this business.
8. Reply in the same language the user uses (Hindi or English).`

const FORMAT_PROMPT = `You are an AI assistant for Kothari Synthetic Industries (KSI), a textile dyeing company.
Format the following data into a clear, human-readable response. Use the same language as the user's original question.
Keep it concise but informative. Use numbers and bullet points where helpful.
If data is empty or shows no results, say so politely and suggest checking the spelling or trying a different query.
Do NOT use markdown formatting like ** or ## — just plain text with line breaks.
Respond in Hindi if the user asked in Hindi, otherwise English.`

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

    // Step 4: Send data back to Gemini for formatting
    const dataStr = JSON.stringify(data, null, 2)
    const formatMessage = `User's question: "${message}"\n\nFunction called: ${parsed.function}\nArguments: ${JSON.stringify(parsed.args)}\n\nData returned:\n${dataStr.slice(0, 8000)}\n\nFormat a clear, concise response for the user.`

    const formattedReply = await callGemini(FORMAT_PROMPT, formatMessage, [])

    return NextResponse.json({ reply: formattedReply })
  } catch (err: any) {
    console.error('AI Chat error:', err?.message, err?.stack)
    return NextResponse.json({ reply: `Error: ${err?.message || 'Something went wrong. Please try again.'}` })
  }
}
