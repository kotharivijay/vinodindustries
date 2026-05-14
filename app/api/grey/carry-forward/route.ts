export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GoogleAuth } from 'google-auth-library'
import { normalizeLotNo } from '@/lib/lot-no'

const LAST_YEAR_SHEET_ID = '1AGOnIxF5HYZSJuD3Hs4_e5NDfS7gL_zVd-AkQdvF9UA'

// Lots that conflict with current year — rename by adding "0" at the end
const CARRY_FORWARD_RENAMES: Record<string, string> = {
  'YC-773': 'YC-7730',
  'PS-823': 'PS-8230',
  'AJ-1212': 'AJ-12120',
  'PS-1223': 'PS-12230',
  'PS-1224': 'PS-12240',
  'PS-1227': 'PS-12270',
  'PS-1228': 'PS-12280',
  'PS-1229': 'PS-12290',
  'PS-1242': 'PS-12420',
  'PS-1246': 'PS-12460',
  'SSF-1260': 'SSF-12600',
  'AJ-1264': 'AJ-12640',
}

async function readLastYearSheet(): Promise<string[][] | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null
  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  const client = await auth.getClient()
  const token = await client.getAccessToken()

  // Read from row 4 (data starts), all columns A to AK
  const range = encodeURIComponent('A4:AK')
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${LAST_YEAR_SHEET_ID}/values/${range}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } })
  if (!res.ok) return null
  const data = await res.json()
  return data.values || []
}

// GET - list all opening balances
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  try {
    const balances = await db.lotOpeningBalance.findMany({
      include: { despatchHistory: { orderBy: { setNo: 'asc' } } },
      orderBy: { lotNo: 'asc' },
    })
    return NextResponse.json(balances)
  } catch {
    return NextResponse.json([])
  }
}

// POST - import carry-forward from last year sheet
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await readLastYearSheet()
  if (!rows) return NextResponse.json({ error: 'Failed to read last year sheet' }, { status: 500 })

  const db = prisma as any

  // Delete existing opening balances (re-import)
  try {
    await db.lotOpeningBalance.deleteMany({})
  } catch {}

  let imported = 0
  let skipped = 0
  let totalThan = 0

  for (const row of rows) {
    const rawLotNo = (row[16] || '').trim() // Q
    // ALL opening stock lots: append 0 to separate from current year lot numbers
    // Also check specific renames for additional conflicts
    const renameKey = Object.keys(CARRY_FORWARD_RENAMES).find(k => k.toLowerCase() === rawLotNo.toLowerCase())
    let lotNo = renameKey ? CARRY_FORWARD_RENAMES[renameKey] : rawLotNo
    // If not already renamed (doesn't end with 0 from rename map), append 0
    if (!renameKey && lotNo) {
      lotNo = lotNo + '0'
    }
    lotNo = normalizeLotNo(lotNo) ?? ''
    const rawSn = (row[0] || '').trim() // A — SN from sheet
    const snValue = rawSn.startsWith('O') ? rawSn : 'O' + rawSn // Prefix O if not already
    const stock = parseInt(row[17]) || 0  // R
    const totalDesp = parseInt(row[18]) || 0 // S
    const than = parseInt(row[7]) || 0 // H (grey than)
    const party = (row[4] || '').trim() // E
    const quality = (row[5] || '').trim() // F
    const weight = (row[6] || '').trim() // G — weight e.g. ".98g", "90g"
    const grayMtrRaw = (row[8] || '').replace(/,/g, '').trim() // I — gray mtr
    const grayMtr = parseFloat(grayMtrRaw) || null

    // Parse grey inward date from column C (DD/MM/YYYY or MM/DD/YYYY)
    let greyDate: Date | null = null
    const dateStr = (row[2] || '').trim()
    if (dateStr) {
      const parts = dateStr.split('/')
      if (parts.length === 3) {
        let d = parseInt(parts[0]), m = parseInt(parts[1]), y = parseInt(parts[2])
        if (y < 100) y = 2000 + y
        // If first part > 12, it's DD/MM/YYYY; else could be MM/DD/YYYY
        if (d > 12) { greyDate = new Date(y, m - 1, d) }
        else if (m > 12) { greyDate = new Date(y, d - 1, m) } // MM/DD/YYYY
        else { greyDate = new Date(y, m - 1, d) } // assume DD/MM/YYYY
      }
    }

    if (!lotNo || stock <= 0) { skipped++; continue }

    // Extract despatch sets
    const despSets = []
    // Set 1: V(21), W(22), X(23), Y(24)
    if (row[21]) despSets.push({ setNo: 1, challanNo: row[21] || null, than: parseInt(row[22]) || null, billNo: row[23] || null, rate: parseFloat(row[24]) || null })
    // Set 2: Z(25), AA(26), AB(27), AC(28)
    if (row[25]) despSets.push({ setNo: 2, challanNo: row[25] || null, than: parseInt(row[26]) || null, billNo: row[27] || null, rate: parseFloat(row[28]) || null })
    // Set 3: AD(29), AE(30), AF(31), AG(32)
    if (row[29]) despSets.push({ setNo: 3, challanNo: row[29] || null, than: parseInt(row[30]) || null, billNo: row[31] || null, rate: parseFloat(row[32]) || null })
    // Set 4: AH(33), AI(34), AJ(35), AK(36)
    if (row[33]) despSets.push({ setNo: 4, challanNo: row[33] || null, than: parseInt(row[34]) || null, billNo: row[35] || null, rate: parseFloat(row[36]) || null })

    try {
      await db.lotOpeningBalance.upsert({
        where: { lotNo },
        create: {
          lotNo,
          financialYear: '2025-26',
          openingThan: stock,
          greyThan: than,
          totalDespatched: totalDesp,
          party,
          quality,
          weight: weight || null,
          grayMtr,
          greyDate,
          notes: `SN:${snValue} | Imported from 2024-25 sheet`,
          despatchHistory: despSets.length ? { create: despSets } : undefined,
        },
        update: {
          openingThan: stock,
          greyThan: than,
          totalDespatched: totalDesp,
          party,
          quality,
          weight: weight || null,
          grayMtr,
          greyDate,
        },
      })
      imported++
      totalThan += stock
    } catch { skipped++ }
  }

  return NextResponse.json({ imported, skipped, totalThan, total: rows.length })
}

// PATCH - update a single opening balance by lotNo
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { lotNo, weight, grayMtr, party, quality, openingThan, notes } = body
  if (!lotNo) return NextResponse.json({ error: 'lotNo required' }, { status: 400 })

  const db = prisma as any
  const existing = await db.lotOpeningBalance.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: any = {}
  if (weight !== undefined) data.weight = weight || null
  if (grayMtr !== undefined) data.grayMtr = grayMtr != null ? parseFloat(grayMtr) : null
  if (party !== undefined) data.party = party || null
  if (quality !== undefined) data.quality = quality || null
  if (openingThan !== undefined) data.openingThan = parseInt(openingThan) || 0
  if (notes !== undefined) data.notes = notes || null

  const updated = await db.lotOpeningBalance.update({
    where: { id: existing.id },
    data,
  })
  return NextResponse.json(updated)
}

// DELETE - clear all opening balances
export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  try { await db.lotOpeningBalance.deleteMany({}) } catch {}
  return NextResponse.json({ ok: true })
}
