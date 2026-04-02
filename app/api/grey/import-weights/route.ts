import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { google } from 'googleapis'

const SHEET_ID = '1AGOnIxF5HYZSJuD3Hs4_e5NDfS7gL_zVd-AkQdvF9UA'
const SHEET_NAME = 'INWERD GRAY'

function parseWeight(raw: string | undefined | null): number | null {
  if (!raw) return null
  const s = raw.toString().trim()
  if (!s || s === '0' || s.toUpperCase().includes('RG')) return null

  // Range like ".85-95g" → average
  const rangeMatch = s.match(/\.(\d+)\s*-\s*(\d+)g?/i)
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10)
    const b = parseInt(rangeMatch[2], 10)
    return Math.round((a + b) / 2)
  }

  // ".80g" → 80, ".050g" → 50, "119g" → 119, ".110g" → 110
  const match = s.match(/\.?0*(\d+)g?/i)
  if (match) {
    return parseInt(match[1], 10)
  }
  return null
}

function parseGrayMtr(raw: string | undefined | null): number | null {
  if (!raw) return null
  const s = raw.toString().trim().replace(/,/g, '')
  if (!s) return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function parseThan(raw: string | undefined | null): number | null {
  if (!raw) return null
  const s = raw.toString().trim().replace(/,/g, '')
  if (!s) return null
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

function parseDate(raw: string | undefined | null): Date | null {
  if (!raw) return null
  const s = raw.toString().trim()
  // Try dd/mm/yyyy or d/m/yyyy
  const parts = s.split('/')
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10)
    const year = parseInt(parts[2], 10)
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      return new Date(year, month - 1, day)
    }
  }
  return null
}

function isInFY2526(d: Date): boolean {
  const start = new Date(2025, 3, 1) // April 1 2025
  const end = new Date(2026, 2, 31, 23, 59, 59) // March 31 2026
  return d >= start && d <= end
}

async function getSheetData() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}')
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME}'`,
  })
  return res.data.values || []
}

// POST: Fetch sheet data, compare with DB, return diff
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await getSheetData()
    // Row 0,1 = summary, row 2 = header, data starts at row 3
    const dataRows = rows.slice(3)

    interface SheetRow {
      lotNo: string
      weight: number | null
      than: number | null
      grayMtr: number | null
      avgCut: number | null
    }

    const sheetEntries: SheetRow[] = []

    for (const row of dataRows) {
      const date = parseDate(row[2])
      if (!date || !isInFY2526(date)) continue

      const lotNo = (row[16] || '').toString().trim()
      if (!lotNo) continue

      const weight = parseWeight(row[6])
      const than = parseThan(row[7])
      const grayMtr = parseGrayMtr(row[8])
      const avgCut = than && than > 0 && grayMtr ? Math.round((grayMtr / than) * 10) / 10 : null

      sheetEntries.push({ lotNo, weight, than, grayMtr, avgCut })
    }

    // Fetch all GreyEntries from DB
    const dbEntries = await prisma.greyEntry.findMany({
      select: { id: true, lotNo: true, weight: true, grayMtr: true, than: true },
    })

    // Build lookup by lowercase lotNo
    const dbMap = new Map<string, typeof dbEntries[0]>()
    for (const e of dbEntries) {
      dbMap.set(e.lotNo.trim().toLowerCase(), e)
    }

    const needsUpdate: Array<{
      lotNo: string
      than: number | null
      dbWeight: string | null
      dbMtr: number | null
      sheetWeight: number | null
      sheetMtr: number | null
      sheetAvgCut: number | null
    }> = []
    const notFoundLots: string[] = []
    let matched = 0
    let alreadyFilled = 0
    const seen = new Set<string>()

    for (const s of sheetEntries) {
      const key = s.lotNo.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      const dbEntry = dbMap.get(key)
      if (!dbEntry) {
        notFoundLots.push(s.lotNo)
        continue
      }

      matched++

      const dbWeightMissing = !dbEntry.weight || dbEntry.weight === '0' || dbEntry.weight === ''
      const dbMtrMissing = dbEntry.grayMtr === null || dbEntry.grayMtr === 0

      if ((dbWeightMissing || dbMtrMissing) && (s.weight || s.grayMtr)) {
        needsUpdate.push({
          lotNo: s.lotNo,
          than: s.than,
          dbWeight: dbEntry.weight,
          dbMtr: dbEntry.grayMtr,
          sheetWeight: s.weight,
          sheetMtr: s.grayMtr,
          sheetAvgCut: s.avgCut,
        })
      } else {
        alreadyFilled++
      }
    }

    return NextResponse.json({
      sheetRows: sheetEntries.length,
      matched,
      notFound: notFoundLots.length,
      needsUpdate,
      alreadyFilled,
      notFoundLots,
    })
  } catch (err: any) {
    console.error('import-weights POST error:', err)
    return NextResponse.json({ error: err.message || 'Failed to fetch sheet data' }, { status: 500 })
  }
}

// PATCH: Update selected lots with weight/grayMtr
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { lots } = await req.json() as {
      lots: Array<{ lotNo: string; weight: number | null; grayMtr: number | null }>
    }

    if (!lots || !Array.isArray(lots)) {
      return NextResponse.json({ error: 'Invalid body: lots array required' }, { status: 400 })
    }

    let updated = 0

    for (const lot of lots) {
      const lotKey = lot.lotNo.trim().toLowerCase()
      // Find DB entry by lotNo (case-insensitive)
      const dbEntry = await prisma.greyEntry.findFirst({
        where: { lotNo: { equals: lot.lotNo, mode: 'insensitive' } },
      })
      if (!dbEntry) continue

      const data: any = {}
      if (lot.weight !== null && lot.weight !== undefined) {
        // weight is stored as String in DB (e.g. "106g")
        data.weight = `${lot.weight}g`
      }
      if (lot.grayMtr !== null && lot.grayMtr !== undefined) {
        data.grayMtr = lot.grayMtr
      }

      if (Object.keys(data).length > 0) {
        await prisma.greyEntry.update({
          where: { id: dbEntry.id },
          data,
        })
        updated++
      }
    }

    return NextResponse.json({ updated })
  } catch (err: any) {
    console.error('import-weights PATCH error:', err)
    return NextResponse.json({ error: err.message || 'Update failed' }, { status: 500 })
  }
}
