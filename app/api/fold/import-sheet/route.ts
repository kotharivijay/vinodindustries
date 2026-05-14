export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GoogleAuth } from 'google-auth-library'
import { normalizeLotNo } from '@/lib/lot-no'

export const maxDuration = 60

const FOLD_SHEET_ID = '1X-00tg7c8spKsFS7TZ9NTYR3HUnfNpvqHQOVSAyfkmc'

async function readFoldSheet(): Promise<string[][] | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null
  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  const client = await auth.getClient()
  const token = await client.getAccessToken()

  // Sheet currently runs ~500+ rows (last fold is past row 500). Read up to
  // row 5000 so we don't silently lose new folds appended at the bottom.
  const range = encodeURIComponent("'Sheet1'!A1:Z5000")
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${FOLD_SHEET_ID}/values/${range}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } })
  if (!res.ok) return null
  const data = await res.json()
  return data.values || []
}

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

function parseDate(val: string): string {
  if (!val) return new Date().toISOString().split('T')[0]
  const parts = val.split('/')
  if (parts.length === 3) {
    const [d, m, y] = parts
    let year = parseInt(y)
    if (year < 100) year = 2000 + year
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return new Date().toISOString().split('T')[0]
}

interface ParsedFold {
  foldNo: string
  partyName: string
  qualityName: string
  date: string
  lotColumns: { lotNo: string; colIndex: number }[]
  batches: {
    sn: number
    date: string
    marka?: string
    shadeNo: string
    shadeName: string
    lots: { lotNo: string; than: number }[]
  }[]
}

// POST — read sheet, parse folds, return preview
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json().catch(() => ({ action: 'preview' }))

  const rows = await readFoldSheet()
  if (!rows) return NextResponse.json({ error: 'Failed to read fold sheet' }, { status: 500 })

  // Parse fold blocks
  const folds: ParsedFold[] = []
  let i = 0

  while (i < rows.length) {
    const row = rows[i]
    const colA = (row[0] || '').trim().toLowerCase()

    // Find fold header row: col A has "fold-X"
    if (!colA.startsWith('fold-')) { i++; continue }

    const foldNo = colA.replace('fold-', '').trim()

    // This row is the column headers row: fold-X | Sn | Date | Slip No | Shade No | Shade Name | Lot1 | Lot2 | ... | Total
    // Extract lot columns (from index 6 onwards, skip "Total")
    const lotColumns: { lotNo: string; colIndex: number }[] = []
    for (let c = 6; c < row.length; c++) {
      const val = (row[c] || '').trim()
      if (val.toLowerCase() === 'total' || !val) continue
      lotColumns.push({ lotNo: val, colIndex: c })
    }

    // Previous rows have party/quality info
    // Row -2 from fold header: "Dyeing Fold Date:-..." | "Fold No Party X"
    // Row -1 from fold header: Party name | Quality | Lot/Than info
    let partyName = ''
    let qualityName = ''
    let foldDate = ''

    if (i >= 2) {
      const headerRow = rows[i - 2]
      const partyRow = rows[i - 1]

      // Extract date from header row
      const dateMatch = ((headerRow[1] || '') + (headerRow[0] || '')).match(/Date[:\-\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
      if (dateMatch) foldDate = parseDate(dateMatch[1])

      // Party name from col 1 of party row
      partyName = (partyRow[1] || '').trim()

      // Quality from col 4 of party row
      qualityName = (partyRow[4] || '').trim()
    }

    if (!foldDate) foldDate = new Date().toISOString().split('T')[0]

    // Read data rows until total row or empty row
    const batches: ParsedFold['batches'] = []
    i++ // move past header row

    while (i < rows.length) {
      const dataRow = rows[i]
      if (!dataRow || dataRow.length === 0 || (dataRow.every(c => !c || !c.trim()))) {
        i++; break // empty row = end of block
      }

      const sn = parseInt(dataRow[1]) || 0
      const dateVal = (dataRow[2] || '').trim()
      const marka = (dataRow[3] || '').trim()
      const shadeNo = (dataRow[4] || '').trim()
      const shadeName = (dataRow[5] || '').trim()

      // If no SN → this is the total row, end of fold
      if (!sn) {
        i++; break
      }

      // Read per-lot than values
      const lots: { lotNo: string; than: number }[] = []
      for (const lc of lotColumns) {
        const val = parseInt(dataRow[lc.colIndex]) || 0
        if (val > 0) {
          lots.push({ lotNo: lc.lotNo, than: val })
        }
      }

      if (lots.length > 0) {
        batches.push({
          sn,
          date: dateVal ? parseDate(dateVal) : foldDate,
          shadeNo,
          shadeName,
          lots,
        })
      }

      i++
    }

    if (batches.length > 0) {
      folds.push({ foldNo, partyName, qualityName, date: foldDate, lotColumns, batches })
    }
  }

  // Preview mode — exclude existing folds, validate lots
  if (action === 'preview') {
    const db = prisma as any
    const existingFolds = await db.foldProgram.findMany({ select: { foldNo: true } })
    const existingSet = new Set(existingFolds.map((f: any) => f.foldNo.toLowerCase().trim()))

    // Filter out already imported folds
    const newFolds = folds.filter(f => !existingSet.has(f.foldNo.toLowerCase().trim()))
    const skippedCount = folds.length - newFolds.length

    // Get all unique lot numbers across all new folds
    const allLotNos = new Set<string>()
    for (const f of newFolds) {
      for (const b of f.batches) {
        for (const l of b.lots) allLotNos.add(l.lotNo)
      }
    }

    // `allLotNos` comes from the fold spreadsheet — its casing can differ
    // from every DB table below, so each `in` filter is case-insensitive
    // (the result maps are already keyed lower-case).
    const lotNoIn = { in: Array.from(allLotNos), mode: 'insensitive' as const }

    // Fetch grey stock for validation
    const greyEntries = await prisma.greyEntry.groupBy({
      by: ['lotNo'],
      where: { lotNo: lotNoIn },
      _sum: { than: true },
    })
    const greyMap = new Map(greyEntries.map(g => [g.lotNo.toLowerCase().trim(), g._sum.than ?? 0]))

    // Fetch despatch totals
    const despEntries = await prisma.despatchEntry.groupBy({
      by: ['lotNo'],
      where: { lotNo: lotNoIn },
      _sum: { than: true },
    })
    const despMap = new Map(despEntries.map(d => [d.lotNo.toLowerCase().trim(), d._sum.than ?? 0]))

    // Fetch already fold-programmed totals
    const foldLots = await db.foldBatchLot.findMany({
      select: { lotNo: true, than: true },
      where: { lotNo: lotNoIn },
    })
    const foldMap = new Map<string, number>()
    for (const fl of foldLots) {
      const key = fl.lotNo.toLowerCase().trim()
      foldMap.set(key, (foldMap.get(key) || 0) + fl.than)
    }

    // Opening balances
    const obs = await db.lotOpeningBalance.findMany({
      where: { lotNo: lotNoIn },
      select: { lotNo: true, openingThan: true },
    })
    const obMap = new Map<string, number>(obs.map((o: any) => [o.lotNo.toLowerCase().trim(), o.openingThan as number]))

    // Manual reservations
    const reserves = await db.lotManualReservation.findMany({
      where: { lotNo: lotNoIn },
      select: { lotNo: true, usedThan: true },
    })
    const reserveMap = new Map<string, number>(reserves.map((r: any) => [r.lotNo.toLowerCase().trim(), r.usedThan as number]))

    // Dyeing used without fold (standalone dyeing entries)
    const dyeLots = await db.dyeingEntryLot.findMany({
      where: { lotNo: lotNoIn },
      select: { lotNo: true, than: true, entry: { select: { foldBatchId: true } } },
    })
    const dyeMap = new Map<string, number>()
    for (const d of dyeLots) {
      if (!d.entry?.foldBatchId) {
        const key = d.lotNo.toLowerCase().trim()
        dyeMap.set(key, (dyeMap.get(key) || 0) + d.than)
      }
    }

    // Validate each fold
    const previewFolds = newFolds.map(f => {
      const allLots = [...new Set(f.batches.flatMap(b => b.lots.map(l => l.lotNo)))]
      const lotValidations: { lotNo: string; needed: number; available: number; status: 'ok' | 'low' | 'not_found' }[] = []

      for (const lotNo of allLots) {
        const key = lotNo.toLowerCase().trim()
        const greyThan = greyMap.get(key) ?? 0
        const ob = obMap.get(key) ?? 0
        const desp = despMap.get(key) ?? 0
        const folded = foldMap.get(key) ?? 0
        const manual = reserveMap.get(key) ?? 0
        const dyeUsed = dyeMap.get(key) ?? 0
        const stock = ob + greyThan - desp
        const available = Math.max(0, stock - folded - manual - dyeUsed)
        const needed = f.batches.reduce((s, b) => s + b.lots.filter(l => l.lotNo === lotNo).reduce((ls, l) => ls + l.than, 0), 0)

        if (stock <= 0 && greyThan === 0 && ob === 0) {
          lotValidations.push({ lotNo, needed, available: 0, status: 'not_found' })
        } else if (available < needed) {
          lotValidations.push({ lotNo, needed, available: Math.max(0, available), status: 'low' })
        } else {
          lotValidations.push({ lotNo, needed, available, status: 'ok' })
        }
      }

      const hasError = lotValidations.some(l => l.status === 'not_found')
      const hasWarning = lotValidations.some(l => l.status === 'low')

      return {
        foldNo: f.foldNo,
        partyName: f.partyName,
        qualityName: f.qualityName,
        date: f.date,
        batchCount: f.batches.length,
        lots: allLots,
        totalThan: f.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0),
        shadeNo: f.batches[0]?.shadeNo || '',
        shadeName: f.batches[0]?.shadeName || '',
        lotValidations,
        status: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
      }
    })

    return NextResponse.json({
      folds: previewFolds,
      total: folds.length,
      newCount: newFolds.length,
      skippedCount,
    })
  }

  // Import mode
  const db = prisma as any
  const results: { foldNo: string; status: string; error?: string }[] = []

  for (const fold of folds) {
    try {
      // Find or create party
      let party = await prisma.party.findFirst({ where: { name: { equals: fold.partyName, mode: 'insensitive' } } })
      if (!party && fold.partyName) {
        party = await prisma.party.create({ data: { name: fold.partyName } })
      }

      // Find or create quality
      let quality = await prisma.quality.findFirst({ where: { name: { equals: fold.qualityName, mode: 'insensitive' } } })
      if (!quality && fold.qualityName) {
        quality = await prisma.quality.create({ data: { name: fold.qualityName } })
      }

      // Check if fold already exists
      const existing = await db.foldProgram.findFirst({ where: { foldNo: fold.foldNo } })
      if (existing) {
        results.push({ foldNo: fold.foldNo, status: 'skipped', error: 'Already exists' })
        continue
      }

      // Pre-fetch all unique shades for this fold's batches
      const uniqueShadeNos = [...new Set(fold.batches.map(b => b.shadeNo).filter(Boolean))]
      const shadeMap = new Map<string, number>()
      for (const sn of uniqueShadeNos) {
        const shade = await db.shade.findFirst({ where: { name: { equals: sn, mode: 'insensitive' } } })
        if (shade) shadeMap.set(sn.toLowerCase().trim(), shade.id)
      }

      // Create fold program with per-batch shade
      await db.foldProgram.create({
        data: {
          foldNo: fold.foldNo,
          date: new Date(fold.date),
          status: 'draft',
          batches: {
            create: fold.batches.map((b, bi) => ({
              batchNo: bi + 1,
              shadeId: shadeMap.get(b.shadeNo.toLowerCase().trim()) ?? null,
              shadeName: b.shadeNo || b.shadeName || null,
              shadeDescription: b.shadeName || null,
              lots: {
                create: b.lots.map(l => ({
                  lotNo: normalizeLotNo(l.lotNo) ?? '',
                  than: l.than,
                  partyId: party?.id ?? null,
                  qualityId: quality?.id ?? null,
                })),
              },
            })),
          },
        },
      })

      results.push({ foldNo: fold.foldNo, status: 'ok' })
    } catch (e: any) {
      results.push({ foldNo: fold.foldNo, status: 'error', error: e.message })
    }
  }

  return NextResponse.json({ results })
}
