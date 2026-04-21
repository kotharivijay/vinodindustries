export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 60

const SHEET_ID = '1QEWGeKg7XyGRT693nkO4vXz0IUDhJHskp5-Wr1fCXHc'
const TAB = 'Sheet1'
const COL = {
  CHALLAN: 0, DATE: 2, DESCRIPTION: 4, LOT_NO: 5, THAN: 7,
  BILL_NO: 8, RATE: 9, LR_NO: 11, TRANSPORT: 12, WEB_STATUS: 19,
}

async function getSheetsToken(): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library')
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set')
  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  const client = await auth.getClient()
  const token = (await client.getAccessToken()).token
  if (!token) throw new Error('Failed to get Sheets token')
  return token
}

async function findOrCreateTransport(name: string): Promise<number> {
  const existing = await prisma.transport.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
  if (existing) return existing.id
  const created = await prisma.transport.create({ data: { name } })
  return created.id
}

function parseRate(s: string): number | null {
  if (!s) return null
  const n = parseFloat(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const mode: 'preview' | 'apply' = body?.mode === 'apply' ? 'apply' : 'preview'

  const token = await getSheetsToken()
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`

  const readRange = encodeURIComponent(`'${TAB}'!A4:T5000`)
  const res = await fetch(`${baseUrl}/values/${readRange}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return NextResponse.json({ error: `Sheet read failed: ${res.status}` }, { status: 500 })
  const sheetData = await res.json()
  const rows: string[][] = sheetData.values || []

  // Collect rows with a numeric web_status (= DespatchEntryLot id)
  type Row = {
    rowIndex: number
    lotEntryId: number
    sheetBillNo: string | null
    sheetRate: number | null
    sheetLrNo: string | null
    sheetTransport: string | null
    sheetDescription: string | null
  }
  const sheetRows: Row[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const ws = (r[COL.WEB_STATUS] || '').toString().trim()
    const id = parseInt(ws, 10)
    if (!Number.isFinite(id) || id <= 0) continue
    sheetRows.push({
      rowIndex: i,
      lotEntryId: id,
      sheetBillNo: (r[COL.BILL_NO] || '').toString().trim() || null,
      sheetRate: parseRate((r[COL.RATE] || '').toString()),
      sheetLrNo: (r[COL.LR_NO] || '').toString().trim() || null,
      sheetTransport: (r[COL.TRANSPORT] || '').toString().trim() || null,
      sheetDescription: (r[COL.DESCRIPTION] || '').toString().trim() || null,
    })
  }

  if (sheetRows.length === 0) {
    return NextResponse.json({ mode, totalSynced: 0, message: 'No rows with a record ID found in col T.' })
  }

  const ids = sheetRows.map(r => r.lotEntryId)
  const lotRows = await prisma.despatchEntryLot.findMany({
    where: { id: { in: ids } },
    include: { entry: { include: { transport: true } } },
  })
  const lotMap = new Map(lotRows.map(l => [l.id, l]))

  // Collect changes
  type FieldChange = { field: string; oldValue: any; newValue: any }
  type RowChange = {
    rowIndex: number
    lotEntryId: number
    challan: number
    lotNo: string
    changes: FieldChange[]       // child-level (DespatchEntryLot)
    parentChanges: FieldChange[] // parent-level (DespatchEntry) — keyed by entryId, deduped below
    entryId: number
  }
  const rowChanges: RowChange[] = []
  // For parent changes, we also track which updates to apply per entry (dedupe)
  const parentUpdateMap = new Map<number, { billNo?: string; rate?: number; lrNo?: string; transportId?: number; narration?: string }>()

  const missing: { rowIndex: number; lotEntryId: number }[] = []

  for (const r of sheetRows) {
    const lot = lotMap.get(r.lotEntryId)
    if (!lot) { missing.push({ rowIndex: r.rowIndex, lotEntryId: r.lotEntryId }); continue }
    const parent = lot.entry
    const rowChange: RowChange = {
      rowIndex: r.rowIndex,
      lotEntryId: r.lotEntryId,
      challan: parent.challanNo,
      lotNo: lot.lotNo,
      entryId: parent.id,
      changes: [],
      parentChanges: [],
    }

    // Child-level: rate, description, amount
    if (lot.rate == null && r.sheetRate != null) {
      rowChange.changes.push({ field: 'rate', oldValue: null, newValue: r.sheetRate })
      const newAmount = lot.than * r.sheetRate
      if (lot.amount == null) rowChange.changes.push({ field: 'amount', oldValue: null, newValue: newAmount })
    }
    if ((lot.description == null || lot.description === '') && r.sheetDescription) {
      rowChange.changes.push({ field: 'description', oldValue: null, newValue: r.sheetDescription })
    }

    // Parent-level: billNo, rate, lrNo, transport, narration
    const pu = parentUpdateMap.get(parent.id) ?? {}
    if ((parent.billNo == null || parent.billNo === '') && r.sheetBillNo && pu.billNo === undefined) {
      pu.billNo = r.sheetBillNo
      rowChange.parentChanges.push({ field: 'billNo', oldValue: null, newValue: r.sheetBillNo })
    }
    if (parent.rate == null && r.sheetRate != null && pu.rate === undefined) {
      pu.rate = r.sheetRate
      rowChange.parentChanges.push({ field: 'rate', oldValue: null, newValue: r.sheetRate })
    }
    if ((parent.lrNo == null || parent.lrNo === '') && r.sheetLrNo && pu.lrNo === undefined) {
      pu.lrNo = r.sheetLrNo
      rowChange.parentChanges.push({ field: 'lrNo', oldValue: null, newValue: r.sheetLrNo })
    }
    if (parent.transportId == null && r.sheetTransport && pu.transportId === undefined) {
      const tid = await findOrCreateTransport(r.sheetTransport)
      pu.transportId = tid
      rowChange.parentChanges.push({ field: 'transport', oldValue: null, newValue: r.sheetTransport })
    }
    if ((parent.narration == null || parent.narration === '') && r.sheetDescription && pu.narration === undefined) {
      pu.narration = r.sheetDescription
      rowChange.parentChanges.push({ field: 'narration', oldValue: null, newValue: r.sheetDescription })
    }
    if (Object.keys(pu).length > 0) parentUpdateMap.set(parent.id, pu)

    if (rowChange.changes.length > 0 || rowChange.parentChanges.length > 0) rowChanges.push(rowChange)
  }

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      totalSynced: sheetRows.length,
      missing,
      rowsWithUpdates: rowChanges.length,
      parentEntriesAffected: parentUpdateMap.size,
      changes: rowChanges.slice(0, 200), // cap preview payload
    })
  }

  // APPLY
  let parentsUpdated = 0
  let childrenUpdated = 0
  const totalFieldsChanged = { parent: 0, child: 0 }

  for (const [entryId, pu] of parentUpdateMap.entries()) {
    totalFieldsChanged.parent += Object.keys(pu).length
    await prisma.despatchEntry.update({ where: { id: entryId }, data: pu })
    parentsUpdated++
  }

  for (const rc of rowChanges) {
    if (rc.changes.length === 0) continue
    const data: any = {}
    for (const c of rc.changes) {
      if (c.field === 'rate') data.rate = c.newValue
      else if (c.field === 'description') data.description = c.newValue
      else if (c.field === 'amount') data.amount = c.newValue
    }
    if (Object.keys(data).length === 0) continue
    await prisma.despatchEntryLot.update({ where: { id: rc.lotEntryId }, data })
    childrenUpdated++
    totalFieldsChanged.child += Object.keys(data).length
  }

  return NextResponse.json({
    mode: 'apply',
    totalSynced: sheetRows.length,
    rowsWithUpdates: rowChanges.length,
    parentsUpdated,
    childrenUpdated,
    fieldsChanged: totalFieldsChanged,
    missing,
  })
}
