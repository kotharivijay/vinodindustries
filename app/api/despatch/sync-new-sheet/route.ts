export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 60

const SHEET_ID = '1QEWGeKg7XyGRT693nkO4vXz0IUDhJHskp5-Wr1fCXHc'
const TAB = 'Sheet1'

// Columns within A:T range (0-based)
const COL = {
  CHALLAN: 0, DATE: 2, DESCRIPTION: 4, LOT_NO: 5, THAN: 7,
  BILL_NO: 8, RATE: 9, LR_NO: 11, TRANSPORT: 12, WEB_STATUS: 19,
}

function parseDDMMYYYY(s: string): Date | null {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (!m) return null
  const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3])
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null
  return new Date(Date.UTC(y, mo - 1, d))
}

async function getSheetsToken(): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library')
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set')
  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  const client = await auth.getClient()
  const token = (await client.getAccessToken()).token
  if (!token) throw new Error('Failed to get Sheets token')
  return token
}

async function findOrCreateParty(name: string): Promise<number> {
  const existing = await prisma.party.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
  if (existing) return existing.id
  const created = await prisma.party.create({ data: { name } })
  return created.id
}

async function findOrCreateQuality(name: string): Promise<number> {
  const existing = await prisma.quality.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
  if (existing) return existing.id
  const created = await prisma.quality.create({ data: { name } })
  return created.id
}

async function findOrCreateTransport(name: string): Promise<number> {
  const existing = await prisma.transport.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
  if (existing) return existing.id
  const created = await prisma.transport.create({ data: { name } })
  return created.id
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await getSheetsToken()
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`

  // Read all data rows (A4:T onward — header is row 3)
  const readRange = encodeURIComponent(`'${TAB}'!A4:T5000`)
  const res = await fetch(`${baseUrl}/values/${readRange}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return NextResponse.json({ error: `Sheet read failed: ${res.status}` }, { status: 500 })
  const sheetData = await res.json()
  const rows: string[][] = sheetData.values || []

  // Preload lot → party/quality map
  const db = prisma as any
  const [greyEntries, obs, qualities] = await Promise.all([
    prisma.greyEntry.findMany({
      select: { lotNo: true, partyId: true, qualityId: true, party: { select: { name: true } }, quality: { select: { name: true } } },
    }),
    db.lotOpeningBalance.findMany({ select: { lotNo: true, party: true, quality: true } }) as Promise<{ lotNo: string; party: string | null; quality: string | null }[]>,
    prisma.quality.findMany({ select: { id: true, name: true } }),
  ])
  const qualityByName = new Map(qualities.map(q => [q.name.toLowerCase(), q]))

  type LotInfo = { partyId: number; qualityId: number; partyName: string; qualityName: string }
  const lotInfo = new Map<string, LotInfo>()
  for (const g of greyEntries) {
    const k = g.lotNo.toUpperCase()
    if (!lotInfo.has(k)) lotInfo.set(k, { partyId: g.partyId, qualityId: g.qualityId, partyName: g.party.name, qualityName: g.quality.name })
  }
  // OB: party/quality are strings — resolve IDs lazily
  const obByLot = new Map<string, { party: string | null; quality: string | null }>()
  for (const ob of obs) obByLot.set(ob.lotNo.toUpperCase(), { party: ob.party, quality: ob.quality })

  async function resolveLot(sheetLot: string): Promise<{ resolvedLot: string; info: LotInfo } | null> {
    const up = sheetLot.trim().toUpperCase()
    const candidates = [up, `${up}0`]
    for (const c of candidates) {
      if (lotInfo.has(c)) return { resolvedLot: c, info: lotInfo.get(c)! }
    }
    for (const c of candidates) {
      const ob = obByLot.get(c)
      if (!ob) continue
      if (!ob.party || !ob.quality) return null
      const partyId = await findOrCreateParty(ob.party)
      let qualityId = qualityByName.get(ob.quality.toLowerCase())?.id
      if (!qualityId) qualityId = await findOrCreateQuality(ob.quality)
      const info: LotInfo = { partyId, qualityId, partyName: ob.party, qualityName: ob.quality }
      lotInfo.set(c, info) // cache
      return { resolvedLot: c, info }
    }
    return null
  }

  // Parse unsynced rows
  type ParsedRow = {
    rowIndex: number  // 0-based within rows (sheet row = rowIndex + 4)
    challan: number
    date: Date
    description: string | null
    sheetLot: string
    resolvedLot: string
    than: number
    billNo: string | null
    rate: number | null
    lrNo: string | null
    transportName: string | null
    lotInfo: LotInfo
  }
  const parsed: ParsedRow[] = []
  const skipped: { row: number; reason: string; lot?: string; challan?: string }[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const webStatus = (r[COL.WEB_STATUS] || '').toString().trim()
    if (webStatus) continue  // already synced
    const challanRaw = (r[COL.CHALLAN] || '').toString().trim()
    const lotRaw = (r[COL.LOT_NO] || '').toString().trim()
    const dateRaw = (r[COL.DATE] || '').toString().trim()
    const thanRaw = (r[COL.THAN] || '').toString().trim()
    if (!challanRaw || !lotRaw || !dateRaw || !thanRaw) {
      if (challanRaw || lotRaw) skipped.push({ row: i + 4, reason: 'missing required field', lot: lotRaw, challan: challanRaw })
      continue
    }
    const challan = parseInt(challanRaw, 10)
    const date = parseDDMMYYYY(dateRaw)
    const than = parseInt(thanRaw, 10)
    if (!Number.isFinite(challan) || !date || !Number.isFinite(than)) {
      skipped.push({ row: i + 4, reason: 'parse error', lot: lotRaw, challan: challanRaw })
      continue
    }
    const lookup = await resolveLot(lotRaw)
    if (!lookup) {
      skipped.push({ row: i + 4, reason: 'lot not found (tried direct + trailing 0)', lot: lotRaw, challan: challanRaw })
      continue
    }
    parsed.push({
      rowIndex: i,
      challan, date, than,
      description: (r[COL.DESCRIPTION] || '').toString().trim() || null,
      sheetLot: lotRaw,
      resolvedLot: lookup.resolvedLot,
      billNo: (r[COL.BILL_NO] || '').toString().trim() || null,
      rate: r[COL.RATE] ? parseFloat(String(r[COL.RATE]).replace(/,/g, '')) : null,
      lrNo: (r[COL.LR_NO] || '').toString().trim() || null,
      transportName: (r[COL.TRANSPORT] || '').toString().trim() || null,
      lotInfo: lookup.info,
    })
  }

  // Group by (challan, date) — each group = one DespatchEntry, each row = one DespatchEntryLot
  type Group = {
    key: string
    challan: number
    date: Date
    rows: ParsedRow[]
  }
  const groupMap = new Map<string, Group>()
  for (const p of parsed) {
    const key = `${p.challan}|${p.date.toISOString().slice(0, 10)}`
    if (!groupMap.has(key)) groupMap.set(key, { key, challan: p.challan, date: p.date, rows: [] })
    groupMap.get(key)!.rows.push(p)
  }

  // Insert
  const writebacks: { rowIndex: number; lotEntryId: number }[] = []
  let entriesCreated = 0
  for (const g of groupMap.values()) {
    const first = g.rows[0]
    const parentPartyId = first.lotInfo.partyId
    const parentQualityId = first.lotInfo.qualityId
    const transportId = first.transportName ? await findOrCreateTransport(first.transportName) : null

    const totalThan = g.rows.reduce((s, r) => s + r.than, 0)
    const pTotal = g.rows.reduce((s, r) => s + (r.rate != null ? r.than * r.rate : 0), 0) || null

    const entry = await prisma.despatchEntry.create({
      data: {
        date: g.date,
        challanNo: g.challan,
        partyId: parentPartyId,
        qualityId: parentQualityId,
        lotNo: first.resolvedLot,
        than: totalThan,
        billNo: first.billNo,
        rate: first.rate,
        pTotal,
        lrNo: first.lrNo,
        transportId,
        narration: first.description,
      },
    })
    entriesCreated++

    for (const r of g.rows) {
      const lotQualityId = r.lotInfo.qualityId !== parentQualityId ? r.lotInfo.qualityId : null
      const amount = r.rate != null ? r.than * r.rate : null
      const lot = await prisma.despatchEntryLot.create({
        data: {
          entryId: entry.id,
          lotNo: r.resolvedLot,
          than: r.than,
          rate: r.rate,
          amount,
          description: r.description,
          qualityId: lotQualityId,
        },
      })
      writebacks.push({ rowIndex: r.rowIndex, lotEntryId: lot.id })
    }
  }

  // Write back lotEntry ids to col T of each sheet row
  if (writebacks.length > 0) {
    const batch = writebacks.map(w => ({
      range: `'${TAB}'!T${w.rowIndex + 4}`,
      values: [[String(w.lotEntryId)]],
    }))
    const writeRes = await fetch(`${baseUrl}/values:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data: batch }),
    })
    if (!writeRes.ok) {
      const text = await writeRes.text()
      return NextResponse.json({
        error: 'Sheet write-back failed after DB insert',
        detail: text.slice(0, 500),
        entriesCreated, lotsCreated: writebacks.length,
      }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    entriesCreated,
    lotsCreated: writebacks.length,
    skipped: skipped.length,
    skippedSamples: skipped.slice(0, 20),
  })
}
