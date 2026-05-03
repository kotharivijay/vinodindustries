export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readDespatchSheet } from '@/lib/sheets'

// Sheet header order:
// A Challan No | B Month | C Date | D A-Job Party | E DESCRIPTION | F A-Lot no |
// G Than | H Meter | I Bill n. | J Rate | K P.total | L Lr.no | M Transport |
// N Bale | O Gray Dt | P-T (ignored)
const COL = {
  CHALLAN: 0, MONTH: 1, DATE: 2, PARTY: 3, QUALITY: 4,
  LOT_NO: 5, THAN: 6, METER: 7,
  BILL_NO: 8, RATE: 9, P_TOTAL: 10,
  LR_NO: 11, TRANSPORT: 12, BALE: 13, GRAY_INW_DATE: 14,
}

function norm(s: string) {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
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

// GET — compare sheet vs DB
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { values, error: sheetError } = await readDespatchSheet()
  if (!values) return NextResponse.json({ error: 'SHEETS_ERROR', message: sheetError }, { status: 403 })
  if (values.length < 2) return NextResponse.json({ error: 'NO_DATA', message: 'No data found.' }, { status: 400 })

  const [, ...dataRows] = values

  const [parties, qualities, transports, dbEntries] = await Promise.all([
    prisma.party.findMany(),
    prisma.quality.findMany(),
    prisma.transport.findMany(),
    prisma.despatchEntry.findMany({
      select: { id: true, challanNo: true, lotNo: true, date: true, createdAt: true,
        party: { select: { name: true } }, quality: { select: { name: true } }, than: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const partyMap = new Map(parties.map(p => [norm(p.name), p]))
  const qualityMap = new Map(qualities.map(q => [norm(q.name), q]))
  const transportMap = new Map(transports.map(t => [norm(t.name), t]))

  // Build key → DB entry list map
  const dbKeyMap = new Map<string, typeof dbEntries>()
  for (const e of dbEntries) {
    const key = `${e.challanNo}|${norm(e.lotNo)}`
    const arr = dbKeyMap.get(key) ?? []
    arr.push(e)
    dbKeyMap.set(key, arr)
  }

  // Parse sheet rows
  interface SheetRow {
    challanNo: number | null
    date: string
    partyName: string
    qualityName: string
    transportName: string
    lotNo: string
    than: number
    rate: number | null
    pTotal: number | null
    missingMasters: string[]
    partyId: number | null
    qualityId: number | null
    transportId: number | null
  }

  const newRows: SheetRow[] = []        // in sheet, not in DB
  const syncedCount: number[] = []     // challan nos synced fine (for count)
  const sheetKeys = new Set<string>()

  for (const row of dataRows) {
    const partyName = row[COL.PARTY]?.trim() ?? ''
    const date = row[COL.DATE]?.trim() ?? ''
    if (!date && !partyName) continue

    const challanNo = parseInt(row[COL.CHALLAN]) || null
    const qualityName = row[COL.QUALITY]?.trim() ?? ''
    const transportName = row[COL.TRANSPORT]?.trim() ?? ''
    const lotNo = row[COL.LOT_NO]?.trim() ?? ''
    const than = parseInt(row[COL.THAN]) || 0
    const rate = parseFloat(row[COL.RATE]) || null
    const meter = parseFloat(row[COL.METER]) || null
    const pTotal = rate
      ? parseFloat((((meter && meter > 0) ? meter : than) * rate).toFixed(2))
      : (parseFloat(row[COL.P_TOTAL]) || null)

    if (!lotNo) continue // skip rows with no lot no

    const key = `${challanNo}|${norm(lotNo)}`
    sheetKeys.add(key)

    const inDB = dbKeyMap.has(key)
    if (inDB) {
      syncedCount.push(challanNo ?? 0)
      continue
    }

    const party = partyMap.get(norm(partyName))
    const quality = qualityMap.get(norm(qualityName))
    const transport = transportName ? transportMap.get(norm(transportName)) : null

    const missingMasters: string[] = []
    if (partyName && !party) missingMasters.push(`Party: "${partyName}"`)
    if (qualityName && !quality) missingMasters.push(`Quality: "${qualityName}"`)
    if (transportName && !transport && norm(transportName) !== 'by hand' && norm(transportName) !== 'open')
      missingMasters.push(`Transport: "${transportName}"`)

    newRows.push({
      challanNo, date, partyName, qualityName, transportName, lotNo, than, rate, pTotal,
      missingMasters,
      partyId: party?.id ?? null,
      qualityId: quality?.id ?? null,
      transportId: transport?.id ?? null,
    })
  }

  // Find DB duplicates: same challan+lot appearing more than once
  interface DbDupGroup {
    key: string
    challanNo: number
    lotNo: string
    partyName: string
    qualityName: string
    entries: { id: number; date: string; createdAt: string; than: number }[]
  }

  const dbDuplicates: DbDupGroup[] = []
  for (const [key, entries] of dbKeyMap) {
    if (entries.length > 1) {
      const [challanStr, lotNo] = key.split('|')
      dbDuplicates.push({
        key,
        challanNo: parseInt(challanStr),
        lotNo: entries[0].lotNo,
        partyName: entries[0].party.name,
        qualityName: entries[0].quality.name,
        entries: entries.map(e => ({
          id: e.id,
          date: e.date.toISOString(),
          createdAt: e.createdAt.toISOString(),
          than: e.than,
        })),
      })
    }
  }

  return NextResponse.json({
    newRows,
    syncedCount: syncedCount.length,
    dbDuplicates,
    summary: {
      sheetTotal: sheetKeys.size,
      newCount: newRows.length,
      syncedCount: syncedCount.length,
      dupGroupCount: dbDuplicates.length,
      dupEntryCount: dbDuplicates.reduce((s, g) => s + g.entries.length - 1, 0),
    },
  })
}

// PUT — import new rows from sync
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows } = await req.json()
  let imported = 0
  const errors: { challanNo: number | null; error: string }[] = []

  for (const row of rows) {
    if (!row.partyId || !row.qualityId || !row.lotNo) continue
    try {
      const date = parseDate(row.date) ?? new Date()
      const transportId = row.transportId ?? (await prisma.transport.findFirst())?.id
      if (!transportId) { errors.push({ challanNo: row.challanNo, error: 'No transport' }); continue }
      await prisma.despatchEntry.create({
        data: {
          date, challanNo: row.challanNo ?? 0,
          partyId: row.partyId, qualityId: row.qualityId,
          lotNo: row.lotNo, than: row.than,
          rate: row.rate ?? null, pTotal: row.pTotal ?? null,
          transportId, bale: null,
        },
      })
      imported++
    } catch (e: any) {
      errors.push({ challanNo: row.challanNo, error: e.message })
    }
  }
  return NextResponse.json({ imported, errors })
}

// DELETE — remove duplicate DB entries by id list
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: 'No ids provided' }, { status: 400 })

  const { count } = await prisma.despatchEntry.deleteMany({ where: { id: { in: ids } } })
  return NextResponse.json({ deleted: count })
}
