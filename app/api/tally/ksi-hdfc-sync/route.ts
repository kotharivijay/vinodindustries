export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'
const HDFC_LEDGER = 'HDFC BANK'

const pad = (n: number) => String(n).padStart(2, '0')
function fmtTallyDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

function fyOf(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth()
  const start = m < 3 ? y - 1 : y
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`
}

// Tally returns dates as "5-May-26" or YYYYMMDD; normalise both.
function parseTallyDate(s: string): Date | null {
  const trimmed = s.trim()
  if (/^\d{8}$/.test(trimmed)) {
    return new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T00:00:00`)
  }
  const m = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/)
  if (m) {
    const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
    const day = parseInt(m[1])
    const mon = months[m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase()]
    const year = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3])
    return new Date(year, mon, day)
  }
  const d = new Date(trimmed)
  return isNaN(d.getTime()) ? null : d
}

const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

interface ParsedRow {
  date: Date
  fy: string
  vchNumber: string
  vchType: string
  partyName: string
  amount: number
  direction: 'in' | 'out'
}

function parseLedgerVouchers(xml: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  // Tally's Ledger Vouchers report is a flat sequence of <DSPVCH*> tags;
  // tokenise by DSPVCHDATE boundaries.
  const tokens = xml.split(/(?=<DSPVCHDATE>)/)
  for (const t of tokens) {
    const dateStr = dec(t.match(/<DSPVCHDATE[^>]*>([^<]*)<\/DSPVCHDATE>/)?.[1] || '')
    if (!dateStr) continue
    const date = parseTallyDate(dateStr)
    if (!date) continue
    const ledger = dec(t.match(/<DSPVCHLEDACCOUNT[^>]*>([^<]*)<\/DSPVCHLEDACCOUNT>/)?.[1] || '')
    const vchType = dec(t.match(/<DSPVCHTYPE[^>]*>([^<]*)<\/DSPVCHTYPE>/)?.[1] || '')
    const vchNumber = dec(t.match(/<DSPVCHNUMBER[^>]*>([^<]*)<\/DSPVCHNUMBER>/)?.[1] || '')
    const drAmt = parseFloat(dec(t.match(/<DSPVCHDRAMT[^>]*>([^<]*)<\/DSPVCHDRAMT>/)?.[1] || '0').replace(/,/g, '')) || 0
    const crAmt = parseFloat(dec(t.match(/<DSPVCHCRAMT[^>]*>([^<]*)<\/DSPVCHCRAMT>/)?.[1] || '0').replace(/,/g, '')) || 0
    if (!vchNumber) continue
    // Dr on HDFC = inflow (Receipt); Cr = outflow (Payment).
    const direction: 'in' | 'out' = Math.abs(drAmt) > 0 ? 'in' : 'out'
    const amount = Math.abs(drAmt) || Math.abs(crAmt)
    if (amount === 0) continue
    rows.push({ date, fy: fyOf(date), vchNumber, vchType, partyName: ledger, amount, direction })
  }
  return rows
}

function buildXML(from: string, to: string): string {
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Ledger Vouchers</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY>
      <SVFROMDATE>${from}</SVFROMDATE>
      <SVTODATE>${to}</SVTODATE>
      <LEDGERNAME>${HDFC_LEDGER}</LEDGERNAME>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`
}

// POST /api/tally/ksi-hdfc-sync — body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
// Default range covers FY25-26 onward to today.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const from = body.from || '2025-04-01'
  const to = body.to || new Date().toISOString().slice(0, 10)

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = process.env.TALLY_API_SECRET
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  let res: Response
  try {
    res = await fetch(tunnelUrl, {
      method: 'POST',
      headers,
      body: buildXML(fmtTallyDate(from), fmtTallyDate(to)),
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Tally tunnel unreachable: ${e?.message || 'network error'}` }, { status: 502 })
  }
  if (!res.ok) return NextResponse.json({ error: `Tally HTTP ${res.status}` }, { status: 502 })

  const xml = await res.text()
  const rows = parseLedgerVouchers(xml)

  // Upsert by (vchNumber, date, vchType) — additive, never destructive.
  const db = prisma as any
  let saved = 0
  const now = new Date()
  for (const r of rows) {
    await db.ksiHdfcReceipt.upsert({
      where: { vch_natural_key: { vchNumber: r.vchNumber, date: r.date, vchType: r.vchType } },
      create: { ...r, lastSynced: now },
      update: { ...r, lastSynced: now },
    })
    saved++
  }

  return NextResponse.json({
    fetched: rows.length,
    saved,
    inflow: rows.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount, 0),
    outflow: rows.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount, 0),
    range: { from, to },
  })
}
