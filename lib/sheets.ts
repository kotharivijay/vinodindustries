import { GoogleAuth } from 'google-auth-library'

const SHEET_ID = process.env.GOOGLE_SHEET_ID!
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME ?? 'INWERD GRAY'

const DESPATCH_SHEET_ID = process.env.DESPATCH_SHEET_ID!
const DESPATCH_SHEET_NAME = process.env.DESPATCH_SHEET_NAME ?? 'Sheet1'

async function getAccessToken(): Promise<string | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null
  try {
    const credentials = JSON.parse(keyJson)
    const auth = new GoogleAuth({
      credentials,
      // Full read+write access to Sheets
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const client = await auth.getClient()
    const token = await client.getAccessToken()
    return token.token ?? null
  } catch {
    return null
  }
}

// Read all data rows from the sheet (returns raw 2D array)
export async function readSheet(): Promise<{ values: string[][] | null; error?: string }> {
  const token = await getAccessToken()
  if (!token) return { values: null, error: 'GOOGLE_SERVICE_ACCOUNT_KEY not configured' }

  const range = encodeURIComponent(`'${SHEET_NAME}'!A3:R`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { values: null, error: err?.error?.message ?? 'Failed to read sheet' }
  }
  const data = await res.json()
  return { values: data.values ?? [] }
}

// Append a new row to the sheet (called when new entry added via web app)
export async function appendRowToSheet(row: (string | number | null)[]): Promise<boolean> {
  const token = await getAccessToken()
  if (!token) return false // silently skip if not configured

  const range = encodeURIComponent(`'${SHEET_NAME}'!A:Q`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  })

  return res.ok
}

// ── Despatch Sheet ──────────────────────────────────────────────────────────

export async function readDespatchSheet(): Promise<{ values: string[][] | null; error?: string }> {
  const token = await getAccessToken()
  if (!token) return { values: null, error: 'GOOGLE_SERVICE_ACCOUNT_KEY not configured' }

  const range = encodeURIComponent(`${DESPATCH_SHEET_NAME}!A3:P`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${DESPATCH_SHEET_ID}/values/${range}`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { values: null, error: err?.error?.message ?? 'Failed to read despatch sheet' }
  }
  const data = await res.json()
  return { values: data.values ?? [] }
}

export async function appendDespatchRowToSheet(row: (string | number | null)[]): Promise<boolean> {
  const token = await getAccessToken()
  if (!token) return false

  const range = encodeURIComponent(`${DESPATCH_SHEET_NAME}!A:P`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${DESPATCH_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  })
  return res.ok
}

export function despatchEntryToSheetRow(entry: {
  date: Date
  challanNo: number
  party: { name: string }
  quality: { name: string }
  grayInwDate?: Date | null
  lotNo: string
  jobDelivery?: string | null
  than: number
  billNo?: string | null
  rate?: number | null
  pTotal?: number | null
  lrNo?: string | null
  transport?: { name: string } | null
  bale?: number | null
}): (string | number | null)[] {
  const fmt = (d: Date) => {
    const m = d.getMonth() + 1
    const day = d.getDate()
    const y = String(d.getFullYear()).slice(-2)
    return `${m}/${day}/${y}`
  }
  const d = new Date(entry.date)
  return [
    entry.challanNo,                      // A: Challan No
    d.getMonth() + 1,                     // B: Month
    fmt(d),                               // C: Date
    entry.party.name,                     // D: A-Job Party
    entry.quality.name,                   // E: A/Quality
    entry.grayInwDate ? fmt(new Date(entry.grayInwDate)) : '', // F: Gray Inw Date
    entry.lotNo,                          // G: A-Lot No
    entry.jobDelivery ?? '',              // H: Job Delivery
    entry.than,                           // I: Than
    entry.billNo ?? '',                   // J: Bill No
    entry.rate ?? '',                     // K: Rate
    entry.pTotal ?? '',                   // L: P.Total
    entry.lrNo ?? '',                     // M: LR No
    entry.transport?.name ?? '',          // N: Transport
    entry.bale ?? '',                     // O: Bale
  ]
}

// ── Grey Sheet ──────────────────────────────────────────────────────────────

// Format a GreyEntry into a sheet row matching column order: A-Q
export function greyEntryToSheetRow(entry: {
  sn?: number | null
  id: number
  date: Date
  challanNo: number
  party: { name: string }
  quality: { name: string }
  weight?: string | null
  than: number
  grayMtr?: number | null
  transport: { name: string }
  transportLrNo?: string | null
  bale?: number | null
  baleNo?: string | null
  echBaleThan?: number | null
  viverNameBill?: string | null
  weaver: { name: string }
  lrNo?: string | null
  lotNo: string
}): (string | number | null)[] {
  const d = new Date(entry.date)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const year = String(d.getFullYear()).slice(-2)
  const dateStr = `${month}/${day}/${year}`

  return [
    entry.sn ?? entry.id,          // A: SN
    month,                          // B: Month
    dateStr,                        // C: Date
    entry.challanNo,                // D: Challan No
    entry.party.name,               // E: A-Party name
    entry.quality.name,             // F: A-Quality
    entry.weight ?? '',             // G: wheight
    entry.than,                     // H: Than
    entry.grayMtr ?? '',            // I: Gray Mtr
    entry.transport.name,           // J: Transport Name
    entry.transportLrNo ?? '',      // K: Transport LR no
    entry.bale ?? '',               // L: Bale
    entry.baleNo ?? '',             // M: Bale No
    entry.echBaleThan ?? '',        // N: ech bale Than
    entry.viverNameBill ?? entry.weaver.name, // O: Viver Name-Bill
    entry.lrNo ?? '',               // P: LR No
    entry.lotNo,                    // Q: A-Lot No
    // R (Stock) and S (T_DESP) are calculated — leave empty
  ]
}
