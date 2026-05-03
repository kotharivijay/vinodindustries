export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readDespatchSheet } from '@/lib/sheets'

// Column indices (0-based). Row 3 = header, Row 4+ = data
// Sheet header order:
// A Challan No | B Month | C Date | D A-Job Party | E DESCRIPTION | F A-Lot no | G Than |
// H Meter | I Bill n. | J Rate | K P.total | L Lr.no | M Transport | N Bale | O Gray Dt |
// P Name of Party | Q Than | R D.Total | S Bale | T web_status   (P–T ignored)
const COL = {
  CHALLAN: 0, MONTH: 1, DATE: 2, PARTY: 3, QUALITY: 4,
  LOT_NO: 5, THAN: 6, METER: 7,
  BILL_NO: 8, RATE: 9, P_TOTAL: 10,
  LR_NO: 11, TRANSPORT: 12, BALE: 13, GRAY_INW_DATE: 14,
}

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

function parseDate(val: string): Date | null {
  if (!val || val.toLowerCase() === 'open') return null
  const parts = val.split('/')
  if (parts.length === 3) {
    const [m, d, y] = parts
    const year = parseInt(y) < 100 ? 2000 + parseInt(y) : parseInt(y)
    return new Date(year, parseInt(m) - 1, parseInt(d))
  }
  return null
}

// Duplicate key: challanNo + lotNo + than + rate (same lot can appear multiple times in same challan)
function buildDupKey(row: { challanNo: number | null; date: string; partyName: string; lotNo: string; than: number; rate: number | null }): string {
  if (row.challanNo) return `ch:${row.challanNo}|lot:${norm(row.lotNo)}|th:${row.than}|r:${row.rate ?? 0}`
  return `dt:${row.date}|p:${norm(row.partyName)}|lot:${norm(row.lotNo)}|th:${row.than}|r:${row.rate ?? 0}`
}

// POST — preview rows from despatch sheet
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { values, error: sheetError } = await readDespatchSheet()
  if (!values) return NextResponse.json({ error: 'SHEETS_ERROR', message: sheetError }, { status: 403 })
  if (values.length < 2) return NextResponse.json({ error: 'NO_DATA', message: 'No data found.' }, { status: 400 })

  const [, ...dataRows] = values // first row = header (row 3), rest = data (row 4+)

  const [parties, transports, existingEntries, greyEntries] = await Promise.all([
    prisma.party.findMany(),
    prisma.transport.findMany(),
    prisma.despatchEntry.findMany({ select: { challanNo: true, date: true, lotNo: true, than: true, rate: true, partyId: true, party: { select: { name: true } } } }),
    prisma.greyEntry.findMany({ select: { lotNo: true, qualityId: true, quality: { select: { name: true } } } }),
  ])

  // Also fetch opening balances for lots not in grey register
  let obList: any[] = []
  try {
    const db = prisma as any
    obList = await db.lotOpeningBalance.findMany({ select: { lotNo: true, quality: true } })
  } catch {}

  // Fetch all qualities for fallback matching
  const allQualities = await prisma.quality.findMany()
  const qualityByName = new Map(allQualities.map(q => [norm(q.name), q]))

  const partyMap = new Map(parties.map(p => [norm(p.name), p]))
  const transportMap = new Map(transports.map(t => [norm(t.name), t]))

  // Build grey register lookup: lotNo -> { qualityId, qualityName }
  const greyLotMap = new Map<string, { qualityId: number; qualityName: string }>()
  for (const g of greyEntries) {
    greyLotMap.set(norm(g.lotNo), { qualityId: g.qualityId, qualityName: g.quality.name })
  }
  // Also add opening balance lots (carry-forward) — match quality by name
  for (const ob of obList) {
    const key = norm(ob.lotNo)
    if (!greyLotMap.has(key) && ob.quality) {
      const q = qualityByName.get(norm(ob.quality))
      if (q) greyLotMap.set(key, { qualityId: q.id, qualityName: q.name })
    }
  }

  // Track known lot numbers (grey + opening balance) for lot existence check
  const knownLots = new Set([
    ...greyEntries.map(g => norm(g.lotNo)),
    ...obList.map((o: any) => norm(o.lotNo)),
  ])

  // Build existing DB duplicate keys (challanNo + lotNo + than + rate)
  const dbKeys = new Set<string>()
  for (const e of existingEntries) {
    const dateStr = new Date(e.date).toISOString().split('T')[0]
    const r = e.rate ?? 0
    if (e.challanNo) dbKeys.add(`ch:${e.challanNo}|lot:${norm(e.lotNo)}|th:${e.than}|r:${r}`)
    dbKeys.add(`dt:${dateStr}|p:${norm(e.party.name)}|lot:${norm(e.lotNo)}|th:${e.than}|r:${r}`)
  }

  const batchKeys = new Set<string>()
  const rows = []
  let sheetTotalThan = 0

  function makeSkippedRow(row: string[], reason: string) {
    return {
      challanNo: parseInt(row[COL.CHALLAN]) || null,
      date: row[COL.DATE]?.trim() ?? '',
      partyName: row[COL.PARTY]?.trim() ?? '',
      qualityName: row[COL.QUALITY]?.trim() ?? '',
      transportName: row[COL.TRANSPORT]?.trim() ?? '',
      lotNo: row[COL.LOT_NO]?.trim() ?? '',
      than: parseInt(row[COL.THAN]) || 0,
      meter: null, billNo: '', rate: null, pTotal: null, lrNo: '',
      bale: null, narration: '', grayInwDate: '', jobDelivery: '',
      partyId: null, qualityId: null, qualityName2: null, transportId: null,
      lotInGrey: false, missingMasters: [],
      status: 'skipped' as const,
      skipReason: reason,
    }
  }

  for (const row of dataRows) {
    const date = row[COL.DATE]?.trim() ?? ''
    const lotNo = row[COL.LOT_NO]?.trim() ?? ''
    const than = parseInt(row[COL.THAN]) || 0
    const partyName = row[COL.PARTY]?.trim() ?? ''

    // Skip completely empty rows (silent)
    if (!date && !partyName && !lotNo) continue

    // Skip rows where Month column (B) is exactly "old year" (case-insensitive)
    const monthVal = (row[COL.MONTH] ?? '').trim().toLowerCase()
    if (monthVal === 'old year') { rows.push(makeSkippedRow(row, 'Old Year entry')); continue }
    if (!date) { rows.push(makeSkippedRow(row, 'Missing Date')); continue }
    if (!lotNo) { rows.push(makeSkippedRow(row, 'Missing Lot No')); continue }
    if (than === 0) { rows.push(makeSkippedRow(row, 'Zero or missing Than')); continue }

    const challanNo = parseInt(row[COL.CHALLAN]) || null
    const narration = row[COL.QUALITY]?.trim() ?? ''  // sheet quality col → narration
    const transportName = row[COL.TRANSPORT]?.trim() ?? ''
    const rate = parseFloat(row[COL.RATE]) || null
    const meter = parseFloat(row[COL.METER]) || null
    // Amount = meter × rate when meter is present, else than × rate. Falls back to sheet's P.total.
    const pTotal = rate
      ? parseFloat((((meter && meter > 0) ? meter : than) * rate).toFixed(2))
      : (parseFloat(row[COL.P_TOTAL]) || null)

    sheetTotalThan += than

    const party = partyMap.get(norm(partyName))
    const transport = transportName ? transportMap.get(norm(transportName)) : null

    // Fetch quality from grey register by lotNo
    const greyInfo = greyLotMap.get(norm(lotNo))

    const missingMasters: string[] = []
    if (partyName && !party) missingMasters.push(`Party: "${partyName}"`)
    if (transportName && !transport && norm(transportName) !== 'by hand' && norm(transportName) !== 'open')
      missingMasters.push(`Transport: "${transportName}"`)

    // Build duplicate key (same lot can appear multiple times in same challan)
    const dupKey = buildDupKey({ challanNo, date, partyName, lotNo, than, rate })
    const isDuplicate = dbKeys.has(dupKey) || batchKeys.has(dupKey)

    const lotInGrey = knownLots.has(norm(lotNo))

    let status: 'ready' | 'missing_masters' | 'duplicate' | 'missing_lot'
    if (isDuplicate) status = 'duplicate'
    else if (missingMasters.length > 0) status = 'missing_masters'
    else if (!lotInGrey) status = 'missing_lot'
    else status = 'ready'

    batchKeys.add(dupKey)

    rows.push({
      challanNo, date,
      partyName, partyId: party?.id ?? null,
      narration,
      lotNo,
      qualityId: greyInfo?.qualityId ?? null,
      qualityName: greyInfo?.qualityName ?? (narration || null),
      lotInGrey,
      grayInwDate: row[COL.GRAY_INW_DATE]?.trim() ?? '',
      jobDelivery: challanNo ? String(challanNo) : '',
      than,
      meter,
      billNo: row[COL.BILL_NO]?.trim() ?? '',
      rate, pTotal,
      lrNo: row[COL.LR_NO]?.trim() ?? '',
      transportName, transportId: transport?.id ?? null,
      bale: parseInt(row[COL.BALE]) || null,
      missingMasters, status,
    })
  }

  const summary = {
    total: rows.length,
    ready: rows.filter(r => r.status === 'ready').length,
    missing_masters: rows.filter(r => r.status === 'missing_masters').length,
    missing_lot: rows.filter(r => r.status === 'missing_lot').length,
    duplicate: rows.filter(r => r.status === 'duplicate').length,
    skipped: rows.filter(r => r.status === 'skipped').length,
    sheetTotalThan,
  }
  return NextResponse.json({ rows, summary })
}

// PUT — import confirmed rows
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows } = await req.json()
  let imported = 0
  const errors: { challanNo: number | null; error: string }[] = []

  for (const row of rows) {
    if (row.status !== 'ready') continue
    if (!row.partyId || !row.lotNo) continue

    try {
      const date = parseDate(row.date) ?? new Date()
      const grayInwDate = row.grayInwDate ? parseDate(row.grayInwDate) : null
      const transportId = row.transportId ?? (await prisma.transport.findFirst())?.id ?? null

      // Quality from grey register OR opening balance
      let qualityId = row.qualityId
      if (!qualityId) {
        const greyMatch = await prisma.greyEntry.findFirst({
          where: { lotNo: { equals: row.lotNo, mode: 'insensitive' } },
          select: { qualityId: true },
        })
        qualityId = greyMatch?.qualityId
      }
      // Fallback: try opening balance quality name → match to quality master
      if (!qualityId) {
        try {
          const db2 = prisma as any
          const ob = await db2.lotOpeningBalance.findFirst({ where: { lotNo: { equals: row.lotNo, mode: 'insensitive' } } })
          if (ob?.quality) {
            const q = await prisma.quality.findFirst({ where: { name: { equals: ob.quality, mode: 'insensitive' } } })
            if (q) qualityId = q.id
          }
        } catch {}
      }
      // Last fallback: create quality from narration
      if (!qualityId && row.narration) {
        try {
          const q = await prisma.quality.findFirst({ where: { name: { equals: row.narration, mode: 'insensitive' } } })
          if (q) qualityId = q.id
          else {
            const created = await prisma.quality.create({ data: { name: row.narration } })
            qualityId = created.id
          }
        } catch {}
      }
      if (!qualityId) { errors.push({ challanNo: row.challanNo, error: 'No quality found for lot ' + row.lotNo }); continue }

      const db = prisma as any
      await db.despatchEntry.create({
        data: {
          date, challanNo: row.challanNo ?? 0,
          partyId: row.partyId, qualityId,
          grayInwDate, lotNo: row.lotNo,
          jobDelivery: row.challanNo ? String(row.challanNo) : null,
          than: row.than,
          meter: row.meter ?? null,
          billNo: row.billNo || null,
          rate: row.rate ?? null,
          pTotal: row.pTotal ?? null,
          lrNo: row.lrNo || null,
          transportId,
          bale: row.bale ?? null,
          narration: row.narration || null,
        },
      })
      imported++
    } catch (e: any) {
      errors.push({ challanNo: row.challanNo, error: e.message })
    }
  }

  const dbAgg = await prisma.despatchEntry.aggregate({ _sum: { than: true } })
  const dbTotalThan = dbAgg._sum.than ?? 0

  return NextResponse.json({ imported, errors, dbTotalThan })
}

// PATCH — auto-create missing masters (parties + transports only)
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows } = await req.json()

  const missingParties = new Map<string, string>()
  const missingTransports = new Map<string, string>()

  for (const row of rows) {
    if (row.status !== 'missing_masters') continue
    if (!row.partyId && row.partyName) missingParties.set(norm(row.partyName), row.partyName)
    if (!row.transportId && row.transportName && norm(row.transportName) !== 'by hand' && norm(row.transportName) !== 'open')
      missingTransports.set(norm(row.transportName), row.transportName)
  }

  const [existingParties, existingTransports] = await Promise.all([
    prisma.party.findMany(),
    prisma.transport.findMany(),
  ])
  const epk = new Set(existingParties.map(p => norm(p.name)))
  const etk = new Set(existingTransports.map(t => norm(t.name)))

  await Promise.all([
    ...[...missingParties.entries()].filter(([k]) => !epk.has(k)).map(([, n]) => prisma.party.create({ data: { name: n } })),
    ...[...missingTransports.entries()].filter(([k]) => !etk.has(k)).map(([, n]) => prisma.transport.create({ data: { name: n } })),
  ])

  const [parties, transports] = await Promise.all([
    prisma.party.findMany(),
    prisma.transport.findMany(),
  ])
  const pm = new Map(parties.map(p => [norm(p.name), p]))
  const tm = new Map(transports.map(t => [norm(t.name), t]))

  // Also re-check grey register for lot quality
  const greyEntries = await prisma.greyEntry.findMany({
    select: { lotNo: true, qualityId: true, quality: { select: { name: true } } },
  })
  const greyLotMap = new Map<string, { qualityId: number; qualityName: string }>()
  for (const g of greyEntries) {
    greyLotMap.set(norm(g.lotNo), { qualityId: g.qualityId, qualityName: g.quality.name })
  }

  const updatedRows = rows.map((row: any) => {
    if (row.status !== 'missing_masters') return row
    const party = pm.get(norm(row.partyName ?? ''))
    const transport = tm.get(norm(row.transportName ?? ''))
    const greyInfo = greyLotMap.get(norm(row.lotNo ?? ''))
    const newRow = {
      ...row,
      partyId: party?.id ?? row.partyId,
      transportId: transport?.id ?? row.transportId,
      qualityId: greyInfo?.qualityId ?? row.qualityId,
      qualityName: greyInfo?.qualityName ?? row.qualityName,
    }

    // Check if all required masters are resolved
    const stillMissing: string[] = []
    if (!newRow.partyId && newRow.partyName) stillMissing.push(`Party: "${newRow.partyName}"`)
    if (!newRow.transportId && newRow.transportName && norm(newRow.transportName) !== 'by hand' && norm(newRow.transportName) !== 'open')
      stillMissing.push(`Transport: "${newRow.transportName}"`)

    if (stillMissing.length === 0 && newRow.partyId && newRow.lotNo) {
      if (!newRow.qualityId) {
        newRow.missingMasters = []
        newRow.status = 'missing_lot'
      } else {
        newRow.missingMasters = []
        newRow.status = 'ready'
      }
    } else {
      newRow.missingMasters = stillMissing
    }
    return newRow
  })

  return NextResponse.json({
    rows: updatedRows,
    created: {
      parties: [...missingParties.keys()].filter(k => !epk.has(k)).length,
      transports: [...missingTransports.keys()].filter(k => !etk.has(k)).length,
    },
  })
}
