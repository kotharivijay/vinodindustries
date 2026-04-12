import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readSheet } from '@/lib/sheets'

// Column indices (0-based). Row 3 = header, Row 4+ = data
const COL = {
  SN: 0, MONTH: 1, DATE: 2, CHALLAN: 3, PARTY: 4, QUALITY: 5,
  WEIGHT: 6, THAN: 7, GRAY_MTR: 8, TRANSPORT: 9, TRANSPORT_LR: 10,
  BALE: 11, BALE_NO: 12, ECH_BALE: 13, WEAVER: 14, LR_NO: 15, LOT_NO: 16,
}

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

function parseSheetDate(val: string, monthCol?: string): Date | null {
  if (!val || val.toLowerCase() === 'open') {
    // No date — use 31/03/2025 as default if no month available
    return new Date(2025, 2, 31) // March 31, 2025
  }
  const parts = val.split('/')
  if (parts.length === 3) {
    // Sheet uses DD/MM/YYYY or DD/MM/YY format
    const [d, m, y] = parts
    let day = parseInt(d)
    let month = parseInt(m)
    let year = parseInt(y)

    // Handle 2-digit year
    if (year < 100) year = 2000 + year

    // Validate — if month > 12, might be M/D/YYYY (US format from some cells)
    if (month > 12 && day <= 12) {
      // Swap: was actually MM/DD/YYYY
      const tmp = day; day = month; month = tmp
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day)
    }
  }

  // Fallback: use month column if available
  if (monthCol) {
    const mo = parseInt(monthCol)
    if (mo >= 1 && mo <= 12) {
      // Use 15th of that month in 2025 as approximate date
      return new Date(2025, mo - 1, 15)
    }
  }

  // Last fallback
  return new Date(2025, 2, 31) // March 31, 2025
}

// Build a unique key for duplicate detection
function buildDupKey(row: { challanNo: number | null; sn: number | null; date: string; partyName: string; lotNo: string; than: number }): string {
  if (row.challanNo) return `ch:${row.challanNo}|lot:${norm(row.lotNo)}`
  if (row.sn) return `sn:${row.sn}|lot:${norm(row.lotNo)}`
  // Normalize sheet date to ISO for consistent matching
  const parsed = parseSheetDate(row.date)
  const dateISO = parsed ? parsed.toISOString().split('T')[0] : row.date
  return `dt:${dateISO}|p:${norm(row.partyName)}|lot:${norm(row.lotNo)}|th:${row.than}`
}

// POST /api/grey/import — fetch & preview rows from Google Sheet
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { values, error: sheetError } = await readSheet()
  if (!values) {
    return NextResponse.json({
      error: 'SHEETS_ERROR',
      message: sheetError ?? 'Failed to read sheet.',
    }, { status: 403 })
  }
  if (values.length < 2) {
    return NextResponse.json({ error: 'NO_DATA', message: 'No data found in sheet.' }, { status: 400 })
  }

  // First row = header (row 3), rest = data (row 4+)
  const [, ...dataRows] = values

  // Load masters
  const [parties, qualities, weavers, transports] = await Promise.all([
    prisma.party.findMany(),
    prisma.quality.findMany(),
    prisma.weaver.findMany(),
    prisma.transport.findMany(),
  ])

  const partyMap = new Map(parties.map((p) => [norm(p.name), p]))
  const qualityMap = new Map(qualities.map((q) => [norm(q.name), q]))
  const weaverMap = new Map(weavers.map((w) => [norm(w.name), w]))
  const transportMap = new Map(transports.map((t) => [norm(t.name), t]))

  // Build existing duplicate keys from DB
  const existing = await prisma.greyEntry.findMany({
    select: { sn: true, challanNo: true, lotNo: true, than: true, date: true, partyId: true, party: { select: { name: true } } },
  })
  const existingKeys = new Set<string>()
  for (const e of existing) {
    if (e.challanNo) existingKeys.add(`ch:${e.challanNo}|lot:${norm(e.lotNo)}`)
    if (e.sn) existingKeys.add(`sn:${e.sn}|lot:${norm(e.lotNo)}`)
    // Always add dt: fallback so rows without challanNo/sn are also detected
    const dateISO = new Date(e.date).toISOString().split('T')[0]
    existingKeys.add(`dt:${dateISO}|p:${norm(e.party.name)}|lot:${norm(e.lotNo)}|th:${e.than}`)
  }

  // Track keys within this import batch
  const batchKeys = new Set<string>()

  const rows = []

  function makeSkippedRow(row: string[], reason: string) {
    return {
      sn: parseInt(row[COL.SN]) || null,
      date: row[COL.DATE]?.trim() ?? '',
      challanNo: parseInt(row[COL.CHALLAN]) || null,
      partyName: row[COL.PARTY]?.trim() ?? '',
      qualityName: row[COL.QUALITY]?.trim() ?? '',
      weaverName: row[COL.WEAVER]?.trim() ?? '',
      transportName: row[COL.TRANSPORT]?.trim() ?? '',
      lotNo: row[COL.LOT_NO]?.trim() ?? '',
      than: parseInt(row[COL.THAN]) || 0,
      weight: row[COL.WEIGHT]?.trim() ?? '',
      grayMtr: null, transportLrNo: '', bale: null, baleNo: '', echBaleThan: null, lrNo: '',
      partyId: null, qualityId: null, weaverId: null, transportId: null,
      missingMasters: [],
      status: 'skipped' as const,
      skipReason: reason,
    }
  }

  for (const row of dataRows) {
    const partyName = row[COL.PARTY]?.trim() ?? ''
    const date = row[COL.DATE]?.trim() ?? ''
    let lotNo = row[COL.LOT_NO]?.trim() ?? ''
    const than = parseInt(row[COL.THAN]) || 0

    // ── Skip rules ──

    // Skip completely empty rows (silent — no point showing blank rows)
    if (!date && !partyName && !lotNo) continue

    // Skip "old year" rows — these are carry-forward lots, handled by LotOpeningBalance
    const monthVal = (row[COL.MONTH] ?? '').trim().toLowerCase()
    if (monthVal === 'old year') continue

    // Skip rows with 0 or empty than
    if (!than || than <= 0) {
      rows.push(makeSkippedRow(row, 'Zero or missing Than'))
      continue
    }

    // Skip rows without lot no
    if (!lotNo) {
      rows.push(makeSkippedRow(row, 'Missing Lot No'))
      continue
    }

    // If no date but has month, we'll use parseSheetDate which handles fallback
    // Only skip if truly empty (no date AND no month)
    if (!date && !monthVal) {
      rows.push(makeSkippedRow(row, 'Missing Date'))
      continue
    }

    // Skip rows without party
    if (!partyName) {
      rows.push(makeSkippedRow(row, 'Missing Party'))
      continue
    }

    // ── Process row ──

    // SN: for opening stock (old year), store as negative to distinguish; for current year, positive
    const rawSn = (row[COL.SN] ?? '').trim()
    const numPart = parseInt(rawSn.replace(/[^0-9]/g, '')) || null
    const sn = (monthVal === 'old year' && numPart) ? -(numPart) : numPart
    const challanNo = parseInt(row[COL.CHALLAN]) || null
    const qualityName = row[COL.QUALITY]?.trim() ?? ''
    const weaverName = row[COL.WEAVER]?.trim() ?? ''
    const transportName = row[COL.TRANSPORT]?.trim() ?? ''

    const party = partyMap.get(norm(partyName))
    const quality = qualityMap.get(norm(qualityName))
    const isPaliPc = party?.tag?.toLowerCase().includes('pali pc job') ?? false
    const marka = isPaliPc ? weaverName : ''
    const actualWeaverName = isPaliPc ? '' : weaverName
    const weaver = actualWeaverName ? weaverMap.get(norm(actualWeaverName)) : null
    const transport = transportMap.get(norm(transportName))

    const missingMasters: string[] = []
    if (!partyName) missingMasters.push('Party: (empty)')
    else if (!party) missingMasters.push(`Party: "${partyName}"`)
    if (!qualityName) missingMasters.push('Quality: (empty)')
    else if (!quality) missingMasters.push(`Quality: "${qualityName}"`)
    if (actualWeaverName && !weaver) missingMasters.push(`Weaver: "${actualWeaverName}"`)
    if (transportName && !transport && transportName.toLowerCase() !== 'open')
      missingMasters.push(`Transport: "${transportName}"`)

    // Multi-level duplicate detection
    const dupKey = buildDupKey({ challanNo, sn, date, partyName, lotNo, than })
    const isDuplicate = existingKeys.has(dupKey) || batchKeys.has(dupKey)
    batchKeys.add(dupKey)

    let status: 'ready' | 'missing_masters' | 'missing_lot' | 'duplicate'
    if (isDuplicate) status = 'duplicate'
    else if (missingMasters.length > 0) status = 'missing_masters'
    else if (!lotNo) status = 'missing_lot'
    else status = 'ready'

    rows.push({
      sn,
      date,
      month: monthVal,
      challanNo,
      partyName,
      qualityName,
      weaverName: actualWeaverName,
      marka,
      transportName,
      lotNo,
      than,
      weight: row[COL.WEIGHT]?.trim() ?? '',
      grayMtr: parseFloat(row[COL.GRAY_MTR]?.replace(/,/g, '')) || null,
      transportLrNo: row[COL.TRANSPORT_LR]?.trim() ?? '',
      bale: parseInt(row[COL.BALE]) || null,
      baleNo: row[COL.BALE_NO]?.trim() ?? '',
      echBaleThan: parseFloat(row[COL.ECH_BALE]) || null,
      lrNo: row[COL.LR_NO]?.trim() ?? '',
      partyId: party?.id ?? null,
      qualityId: quality?.id ?? null,
      weaverId: weaver?.id ?? null,
      transportId: transport?.id ?? null,
      missingMasters,
      status,
    })
  }

  const summary = {
    total: rows.length,
    ready: rows.filter((r) => r.status === 'ready').length,
    missing_masters: rows.filter((r) => r.status === 'missing_masters').length,
    missing_lot: rows.filter((r) => r.status === 'missing_lot').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
  }

  return NextResponse.json({ rows, summary })
}

// PUT /api/grey/import — actually import the confirmed rows
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows } = await req.json()
  let imported = 0
  const errors: { sn: number | null; error: string }[] = []

  for (const row of rows) {
    if (row.status !== 'ready') continue
    if (!row.partyId || !row.qualityId) {
      errors.push({ sn: row.sn, error: `Missing IDs — party:${row.partyId} quality:${row.qualityId} lot:${row.lotNo}` })
      continue
    }
    if (!row.lotNo || !row.than || row.than <= 0) {
      errors.push({ sn: row.sn, error: `Missing lotNo or than` })
      continue
    }

    try {
      const date = parseSheetDate(row.date, row.month) ?? new Date()
      const transportId = row.transportId ?? (await prisma.transport.findFirst())?.id
      if (!transportId) { errors.push({ sn: row.sn, error: 'No transport found' }); continue }
      const weaverId = row.weaverId ?? (await prisma.weaver.findFirst())?.id
      if (!weaverId) { errors.push({ sn: row.sn, error: 'No weaver found' }); continue }

      await prisma.greyEntry.create({
        data: {
          sn: row.sn ?? undefined,
          date,
          challanNo: row.challanNo ?? 0,
          partyId: row.partyId,
          qualityId: row.qualityId,
          weight: row.weight || undefined,
          than: row.than,
          grayMtr: row.grayMtr ?? undefined,
          transportId,
          transportLrNo: row.transportLrNo || undefined,
          bale: row.bale ?? undefined,
          baleNo: row.baleNo || undefined,
          echBaleThan: row.echBaleThan ?? undefined,
          weaverId,
          viverNameBill: row.weaverName || undefined,
          marka: row.marka || undefined,
          lrNo: row.lrNo || undefined,
          lotNo: row.lotNo,
        },
      })
      imported++
    } catch (e: any) {
      errors.push({ sn: row.sn, error: e.message })
    }
  }

  return NextResponse.json({ imported, errors })
}

// PATCH /api/grey/import — auto-create missing masters, return updated rows
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows } = await req.json()

  // Collect unique missing names
  const missingParties = new Map<string, string>()
  const missingQualities = new Map<string, string>()
  const missingWeavers = new Map<string, string>()
  const missingTransports = new Map<string, string>()

  for (const row of rows) {
    if (row.status !== 'missing_masters') continue
    if (!row.partyId && row.partyName) missingParties.set(norm(row.partyName), row.partyName)
    if (!row.qualityId && row.qualityName) missingQualities.set(norm(row.qualityName), row.qualityName)
    if (!row.weaverId && row.weaverName) missingWeavers.set(norm(row.weaverName), row.weaverName)
    if (!row.transportId && row.transportName && norm(row.transportName) !== 'open')
      missingTransports.set(norm(row.transportName), row.transportName)
  }

  // Load existing to avoid duplicates
  const [existingParties, existingQualities, existingWeavers, existingTransports] = await Promise.all([
    prisma.party.findMany(),
    prisma.quality.findMany(),
    prisma.weaver.findMany(),
    prisma.transport.findMany(),
  ])
  const existingPartyKeys = new Set(existingParties.map((p) => norm(p.name)))
  const existingQualityKeys = new Set(existingQualities.map((q) => norm(q.name)))
  const existingWeaverKeys = new Set(existingWeavers.map((w) => norm(w.name)))
  const existingTransportKeys = new Set(existingTransports.map((t) => norm(t.name)))

  // Create only truly new masters
  await Promise.all([
    ...[...missingParties.entries()]
      .filter(([key]) => !existingPartyKeys.has(key))
      .map(([, name]) => prisma.party.create({ data: { name } })),
    ...[...missingQualities.entries()]
      .filter(([key]) => !existingQualityKeys.has(key))
      .map(([, name]) => prisma.quality.create({ data: { name } })),
    ...[...missingWeavers.entries()]
      .filter(([key]) => !existingWeaverKeys.has(key))
      .map(([, name]) => prisma.weaver.create({ data: { name } })),
    ...[...missingTransports.entries()]
      .filter(([key]) => !existingTransportKeys.has(key))
      .map(([, name]) => prisma.transport.create({ data: { name } })),
  ])

  // Reload and re-map
  const [parties, qualities, weavers, transports] = await Promise.all([
    prisma.party.findMany(),
    prisma.quality.findMany(),
    prisma.weaver.findMany(),
    prisma.transport.findMany(),
  ])

  const partyMap = new Map(parties.map((p) => [norm(p.name), p]))
  const qualityMap = new Map(qualities.map((q) => [norm(q.name), q]))
  const weaverMap = new Map(weavers.map((w) => [norm(w.name), w]))
  const transportMap = new Map(transports.map((t) => [norm(t.name), t]))

  const updatedRows = rows.map((row: any) => {
    if (row.status !== 'missing_masters') return row
    const party = partyMap.get(norm(row.partyName ?? ''))
    const quality = qualityMap.get(norm(row.qualityName ?? ''))
    const weaver = weaverMap.get(norm(row.weaverName ?? ''))
    const transport = transportMap.get(norm(row.transportName ?? ''))

    const newRow = {
      ...row,
      partyId: party?.id ?? row.partyId,
      qualityId: quality?.id ?? row.qualityId,
      weaverId: weaver?.id ?? row.weaverId,
      transportId: transport?.id ?? row.transportId,
    }
    if (newRow.partyId && newRow.qualityId && newRow.weaverId && newRow.lotNo) {
      newRow.missingMasters = []
      newRow.status = 'ready'
    }
    return newRow
  })

  return NextResponse.json({
    rows: updatedRows,
    created: {
      parties: [...missingParties.keys()].filter((k) => !existingPartyKeys.has(k)).length,
      qualities: [...missingQualities.keys()].filter((k) => !existingQualityKeys.has(k)).length,
      weavers: [...missingWeavers.keys()].filter((k) => !existingWeaverKeys.has(k)).length,
      transports: [...missingTransports.keys()].filter((k) => !existingTransportKeys.has(k)).length,
    },
  })
}
