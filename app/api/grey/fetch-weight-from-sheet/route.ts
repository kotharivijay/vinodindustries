export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { google } from 'googleapis'

const SHEET_ID = '1FkDEA84AWJxHBMTX7ku67TRdIo-GP1VMOzO_3ZOUVMo'
const SHEET_NAME = 'INWERD GRAY'

function parseWeight(raw: string | undefined | null): number | null {
  if (!raw) return null
  const s = raw.toString().trim()
  if (!s || s === '0' || s.toUpperCase().includes('RG')) return null

  const rangeMatch = s.match(/\.(\d+)\s*-\s*(\d+)g?/i)
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10)
    const b = parseInt(rangeMatch[2], 10)
    return Math.round((a + b) / 2)
  }

  const match = s.match(/\.?0*(\d+)g?/i)
  if (match) {
    return parseInt(match[1], 10)
  }
  return null
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lotNo } = await req.json()
  if (!lotNo || typeof lotNo !== 'string') {
    return NextResponse.json({ error: 'lotNo required' }, { status: 400 })
  }

  const lotKey = lotNo.trim().toLowerCase()
  if (!lotKey) return NextResponse.json({ error: 'lotNo empty' }, { status: 400 })

  try {
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
    const rows = res.data.values || []
    // Row 0 = empty, row 1 = header, data starts at row 2
    const dataRows = rows.slice(2)

    let weightStr: string | null = null
    for (const row of dataRows) {
      const rowLot = (row[16] || '').toString().trim().toLowerCase()
      if (rowLot === lotKey) {
        const w = (row[6] || '').toString().trim()
        if (w) { weightStr = w; break }
      }
    }

    if (!weightStr) {
      return NextResponse.json({ error: `Lot ${lotNo} not found in sheet (or no weight)` }, { status: 404 })
    }

    const weightNum = parseWeight(weightStr)
    if (weightNum == null) {
      return NextResponse.json({ error: `Could not parse weight "${weightStr}"` }, { status: 400 })
    }

    // Update DB: try GreyEntry first, fall back to LotOpeningBalance
    const db = prisma as any

    const grey = await prisma.greyEntry.findFirst({ where: { lotNo: { equals: lotNo.trim(), mode: 'insensitive' } }, select: { id: true } })
    if (grey) {
      await prisma.greyEntry.update({ where: { id: grey.id }, data: { weight: weightStr } })
      return NextResponse.json({ ok: true, weight: weightStr, weightNum, source: 'GreyEntry' })
    }

    const ob = await db.lotOpeningBalance.findFirst({ where: { lotNo: { equals: lotNo.trim(), mode: 'insensitive' } }, select: { id: true } })
    if (ob) {
      await db.lotOpeningBalance.update({ where: { id: ob.id }, data: { weight: weightStr } })
      return NextResponse.json({ ok: true, weight: weightStr, weightNum, source: 'LotOpeningBalance' })
    }

    return NextResponse.json({ error: `Lot ${lotNo} not in DB (neither GreyEntry nor OB)` }, { status: 404 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch weight' }, { status: 500 })
  }
}
