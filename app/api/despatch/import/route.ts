import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readDespatchSheet } from '@/lib/sheets'

// Column indices (0-based). Row 3 = header, Row 4+ = data
const COL = {
  CHALLAN: 0, MONTH: 1, DATE: 2, PARTY: 3, QUALITY: 4,
  GRAY_INW_DATE: 5, LOT_NO: 6, JOB_DELIVERY: 7, THAN: 8,
  BILL_NO: 9, RATE: 10, P_TOTAL: 11, LR_NO: 12, TRANSPORT: 13, BALE: 14,
}

function norm(s: string) {
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

// POST — preview rows from despatch sheet
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { values, error: sheetError } = await readDespatchSheet()
  if (!values) return NextResponse.json({ error: 'SHEETS_ERROR', message: sheetError }, { status: 403 })
  if (values.length < 2) return NextResponse.json({ error: 'NO_DATA', message: 'No data found.' }, { status: 400 })

  const [, ...dataRows] = values

  const [parties, qualities, transports] = await Promise.all([
    prisma.party.findMany(),
    prisma.quality.findMany(),
    prisma.transport.findMany(),
  ])

  const partyMap = new Map(parties.map(p => [norm(p.name), p]))
  const qualityMap = new Map(qualities.map(q => [norm(q.name), q]))
  const transportMap = new Map(transports.map(t => [norm(t.name), t]))

  const existing = await prisma.despatchEntry.findMany({ select: { challanNo: true, lotNo: true } })
  const existingKeys = new Set(existing.map(e => `${e.challanNo}|${norm(e.lotNo)}`))

  const rows = []
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
    const pTotal = rate && than ? parseFloat((than * rate).toFixed(2)) : (parseFloat(row[COL.P_TOTAL]) || null)

    const party = partyMap.get(norm(partyName))
    const quality = qualityMap.get(norm(qualityName))
    const transport = transportName ? transportMap.get(norm(transportName)) : null

    const missingMasters: string[] = []
    if (partyName && !party) missingMasters.push(`Party: "${partyName}"`)
    if (qualityName && !quality) missingMasters.push(`Quality: "${qualityName}"`)
    if (transportName && !transport && norm(transportName) !== 'by hand' && norm(transportName) !== 'open')
      missingMasters.push(`Transport: "${transportName}"`)

    const isDuplicate = challanNo !== null && lotNo ? existingKeys.has(`${challanNo}|${norm(lotNo)}`) : false

    let status: 'ready' | 'missing_masters' | 'missing_lot' | 'duplicate'
    if (isDuplicate) status = 'duplicate'
    else if (missingMasters.length > 0) status = 'missing_masters'
    else if (!lotNo) status = 'missing_lot'
    else status = 'ready'

    rows.push({
      challanNo, date,
      partyName, qualityName, transportName, lotNo,
      grayInwDate: row[COL.GRAY_INW_DATE]?.trim() ?? '',
      jobDelivery: row[COL.JOB_DELIVERY]?.trim() ?? '',
      than, billNo: row[COL.BILL_NO]?.trim() ?? '',
      rate, pTotal,
      lrNo: row[COL.LR_NO]?.trim() ?? '',
      bale: parseInt(row[COL.BALE]) || null,
      partyId: party?.id ?? null,
      qualityId: quality?.id ?? null,
      transportId: transport?.id ?? null,
      missingMasters, status,
    })
  }

  const summary = {
    total: rows.length,
    ready: rows.filter(r => r.status === 'ready').length,
    missing_masters: rows.filter(r => r.status === 'missing_masters').length,
    missing_lot: rows.filter(r => r.status === 'missing_lot').length,
    duplicate: rows.filter(r => r.status === 'duplicate').length,
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
    if (!row.partyId || !row.qualityId || !row.lotNo) continue

    try {
      const date = parseDate(row.date) ?? new Date()
      const grayInwDate = row.grayInwDate ? parseDate(row.grayInwDate) : null
      const transportId = row.transportId ?? (await prisma.transport.findFirst())?.id
      if (!transportId) { errors.push({ challanNo: row.challanNo, error: 'No transport found' }); continue }

      await prisma.despatchEntry.create({
        data: {
          date, challanNo: row.challanNo ?? 0,
          partyId: row.partyId, qualityId: row.qualityId,
          grayInwDate, lotNo: row.lotNo,
          jobDelivery: row.jobDelivery || null,
          than: row.than,
          billNo: row.billNo || null,
          rate: row.rate ?? null,
          pTotal: row.pTotal ?? null,
          lrNo: row.lrNo || null,
          transportId,
          bale: row.bale ?? null,
        },
      })
      imported++
    } catch (e: any) {
      errors.push({ challanNo: row.challanNo, error: e.message })
    }
  }
  return NextResponse.json({ imported, errors })
}

// PATCH — auto-create missing masters
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows } = await req.json()

  const missingParties = new Map<string, string>()
  const missingQualities = new Map<string, string>()
  const missingTransports = new Map<string, string>()

  for (const row of rows) {
    if (row.status !== 'missing_masters') continue
    if (!row.partyId && row.partyName) missingParties.set(norm(row.partyName), row.partyName)
    if (!row.qualityId && row.qualityName) missingQualities.set(norm(row.qualityName), row.qualityName)
    if (!row.transportId && row.transportName && norm(row.transportName) !== 'by hand' && norm(row.transportName) !== 'open')
      missingTransports.set(norm(row.transportName), row.transportName)
  }

  const [existingParties, existingQualities, existingTransports] = await Promise.all([
    prisma.party.findMany(), prisma.quality.findMany(), prisma.transport.findMany(),
  ])
  const epk = new Set(existingParties.map(p => norm(p.name)))
  const eqk = new Set(existingQualities.map(q => norm(q.name)))
  const etk = new Set(existingTransports.map(t => norm(t.name)))

  await Promise.all([
    ...[...missingParties.entries()].filter(([k]) => !epk.has(k)).map(([, n]) => prisma.party.create({ data: { name: n } })),
    ...[...missingQualities.entries()].filter(([k]) => !eqk.has(k)).map(([, n]) => prisma.quality.create({ data: { name: n } })),
    ...[...missingTransports.entries()].filter(([k]) => !etk.has(k)).map(([, n]) => prisma.transport.create({ data: { name: n } })),
  ])

  const [parties, qualities, transports] = await Promise.all([
    prisma.party.findMany(), prisma.quality.findMany(), prisma.transport.findMany(),
  ])
  const pm = new Map(parties.map(p => [norm(p.name), p]))
  const qm = new Map(qualities.map(q => [norm(q.name), q]))
  const tm = new Map(transports.map(t => [norm(t.name), t]))

  const updatedRows = rows.map((row: any) => {
    if (row.status !== 'missing_masters') return row
    const party = pm.get(norm(row.partyName ?? ''))
    const quality = qm.get(norm(row.qualityName ?? ''))
    const transport = tm.get(norm(row.transportName ?? ''))
    const newRow = {
      ...row,
      partyId: party?.id ?? row.partyId,
      qualityId: quality?.id ?? row.qualityId,
      transportId: transport?.id ?? row.transportId,
    }
    if (newRow.partyId && newRow.qualityId && newRow.lotNo) {
      newRow.missingMasters = []
      newRow.status = 'ready'
    }
    return newRow
  })

  return NextResponse.json({
    rows: updatedRows,
    created: {
      parties: [...missingParties.keys()].filter(k => !epk.has(k)).length,
      qualities: [...missingQualities.keys()].filter(k => !eqk.has(k)).length,
      transports: [...missingTransports.keys()].filter(k => !etk.has(k)).length,
    },
  })
}
