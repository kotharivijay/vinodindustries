export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'
const HDFC_LEDGER_RX = /^HDFC BANK$/i

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

function parseTallyDate(s: string): Date | null {
  const t = s.trim()
  if (/^\d{8}$/.test(t)) {
    return new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00`)
  }
  const m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/)
  if (m) {
    const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
    const day = parseInt(m[1])
    const mon = months[m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase()]
    const year = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3])
    return new Date(year, mon, day)
  }
  const d = new Date(t)
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
  narration: string | null
  instrumentNo: string | null
  bankRef: string | null
}

function parseVoucherRegister(xml: string): ParsedRow[] {
  const out: ParsedRow[] = []
  const blocks = xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
  for (const b of blocks) {
    // Find HDFC BANK ledger entry — that's our anchor; vouchers without
    // it aren't bank-side and we skip them.
    const ledgerLines = b.match(/<ALLLEDGERENTRIES\.LIST[^>]*>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g) || []
    let hdfcAmt = 0
    let hdfcDeemedPositive: 'yes' | 'no' | null = null
    let instrumentNo: string | null = null
    let bankRef: string | null = null
    for (const lb of ledgerLines) {
      const lname = dec(lb.match(/<LEDGERNAME[^>]*>([^<]*)<\/LEDGERNAME>/)?.[1] || '')
      if (!HDFC_LEDGER_RX.test(lname)) continue
      hdfcAmt = parseFloat(dec(lb.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/)?.[1] || '0').replace(/,/g, '')) || 0
      const idp = dec(lb.match(/<ISDEEMEDPOSITIVE[^>]*>([^<]*)<\/ISDEEMEDPOSITIVE>/)?.[1] || 'No')
      hdfcDeemedPositive = /yes/i.test(idp) ? 'yes' : 'no'
      const ba = lb.match(/<BANKALLOCATIONS\.LIST[^>]*>[\s\S]*?<\/BANKALLOCATIONS\.LIST>/g) || []
      for (const bA of ba) {
        const inst = dec(bA.match(/<INSTRUMENTNUMBER[^>]*>([^<]*)<\/INSTRUMENTNUMBER>/)?.[1] || '')
        const ref = dec(bA.match(/<UNIQUEREFERENCENUMBER[^>]*>([^<]*)<\/UNIQUEREFERENCENUMBER>/)?.[1] || '')
        if (inst) instrumentNo = inst
        if (ref) bankRef = ref
      }
    }
    if (hdfcAmt === 0) continue

    const dateStr = dec(b.match(/<DATE[^>]*>([^<]*)<\/DATE>/)?.[1] || '')
    const date = parseTallyDate(dateStr)
    if (!date) continue
    const vchNumber = dec(b.match(/<VOUCHERNUMBER[^>]*>([^<]*)<\/VOUCHERNUMBER>/)?.[1] || '')
    if (!vchNumber) continue
    const vchType = dec(b.match(/<VOUCHERTYPENAME[^>]*>([^<]*)<\/VOUCHERTYPENAME>/)?.[1] || '')
    const partyName = dec(b.match(/<PARTYLEDGERNAME[^>]*>([^<]*)<\/PARTYLEDGERNAME>/)?.[1] || '')
    const narration = (dec(b.match(/<NARRATION[^>]*>([^<]*)<\/NARRATION>/)?.[1] || '') || null) as string | null

    // For Receipt vouchers HDFC is debited (deemedPositive=Yes) → "in".
    // For Payment vouchers HDFC is credited (deemedPositive=No) → "out".
    // Vouchers without a clear direction get classified by the sign of
    // hdfcAmt: Tally records HDFC's Dr side as a NEGATIVE amount in XML.
    const direction: 'in' | 'out' = hdfcDeemedPositive === 'yes'
      ? 'in'
      : hdfcDeemedPositive === 'no'
        ? 'out'
        : (hdfcAmt < 0 ? 'in' : 'out')

    out.push({
      date,
      fy: fyOf(date),
      vchNumber,
      vchType,
      partyName,
      amount: Math.abs(hdfcAmt),
      direction,
      narration,
      instrumentNo,
      bankRef,
    })
  }
  return out
}

function buildXML(from: string, to: string, vchType: string): string {
  // Voucher Register report — built-in Tally report. VOUCHERTYPENAME static
  // variable filters reliably (Day Book CHILDOF was loose, returned mixed
  // types). Returns full VOUCHER blocks with narration + bank allocations
  // natively, no custom TDL.
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Voucher Register</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY>
        <SVFROMDATE>${from}</SVFROMDATE>
        <SVTODATE>${to}</SVTODATE>
        <VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`
}

// POST /api/tally/ksi-hdfc-sync
// Body: { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', includePayments?: boolean }
// Default range: 2025-04-01 → today.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const from = body.from || '2025-04-01'
  const to = body.to || new Date().toISOString().slice(0, 10)
  const types: string[] = body.includePayments ? ['Receipt', 'Payment'] : ['Receipt']

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = process.env.TALLY_API_SECRET
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  const tFrom = fmtTallyDate(from)
  const tTo = fmtTallyDate(to)

  const allRows: ParsedRow[] = []
  for (const vt of types) {
    let res: Response
    try {
      res = await fetch(tunnelUrl, { method: 'POST', headers, body: buildXML(tFrom, tTo, vt) })
    } catch (e: any) {
      return NextResponse.json({ error: `Tally tunnel unreachable: ${e?.message || 'network error'}` }, { status: 502 })
    }
    if (!res.ok) return NextResponse.json({ error: `Tally HTTP ${res.status}` }, { status: 502 })
    const xml = await res.text()
    allRows.push(...parseVoucherRegister(xml))
  }

  // Upsert by (vchNumber, date, vchType) — additive. Manual flags
  // (hidden, hiddenReason, hiddenAt) survive re-syncs.
  const db = prisma as any
  let saved = 0
  const now = new Date()
  for (const r of allRows) {
    await db.ksiHdfcReceipt.upsert({
      where: { vch_natural_key: { vchNumber: r.vchNumber, date: r.date, vchType: r.vchType } },
      create: { ...r, lastSynced: now },
      update: {
        fy: r.fy,
        partyName: r.partyName,
        amount: r.amount,
        direction: r.direction,
        narration: r.narration,
        instrumentNo: r.instrumentNo,
        bankRef: r.bankRef,
        lastSynced: now,
      },
    })
    saved++
  }

  return NextResponse.json({
    fetched: allRows.length,
    saved,
    inflow: allRows.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount, 0),
    outflow: allRows.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount, 0),
    range: { from, to },
    types,
  })
}
