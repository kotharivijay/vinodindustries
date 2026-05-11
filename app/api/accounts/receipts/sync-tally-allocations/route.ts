export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST /api/accounts/receipts/sync-tally-allocations
//   Body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
//
// Pulls every Receipt voucher from Tally in the given window, inspects
// each one's party-ledger BILLALLOCATIONS.LIST, and auto-stamps
// `tallyPushedAt` on rows that are already bill-wise (have at least one
// BILLTYPE=Agst Ref entry). On-account-only receipts are left alone.
//
// Matches against KsiHdfcReceipt by the natural key (vchNumber + date +
// vchType=Receipt). Date-only match — the date in Tally's voucher will
// equal what we synced.

const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'
const pad = (n: number) => String(n).padStart(2, '0')
const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
const pickTag = (block: string, tag: string) => dec(block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] || '')

function parseTallyDate(s: string): Date | null {
  const t = s.trim()
  if (/^\d{8}$/.test(t)) return new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00`)
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d
}
function fmtTallyDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}
function monthlyWindows(fromISO: string, toISO: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  const start = new Date(fromISO + 'T00:00:00')
  const end = new Date(toISO + 'T23:59:59')
  let cur = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cur <= end) {
    const winStart = cur < start ? start : cur
    const winEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
    const realEnd = winEnd > end ? end : winEnd
    out.push({
      from: `${winStart.getFullYear()}-${pad(winStart.getMonth() + 1)}-${pad(winStart.getDate())}`,
      to: `${realEnd.getFullYear()}-${pad(realEnd.getMonth() + 1)}-${pad(realEnd.getDate())}`,
    })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return out
}

function buildReceiptRegisterXML(fromDDMMYYYY: string, toDDMMYYYY: string): string {
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
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY>
        <SVFROMDATE>${fromDDMMYYYY}</SVFROMDATE>
        <SVTODATE>${toDDMMYYYY}</SVTODATE>
        <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`
}

interface ClassifiedReceipt {
  vchNumber: string
  date: Date
  hasAgstRef: boolean
  hasOnAccount: boolean
  billCount: number
}

function classifyReceipts(xml: string): ClassifiedReceipt[] {
  const vouchers = xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
  const out: ClassifiedReceipt[] = []
  for (const v of vouchers) {
    const vt = pickTag(v, 'VOUCHERTYPENAME')
    if (vt !== 'Receipt') continue
    const vchNumber = pickTag(v, 'VOUCHERNUMBER').trim()
    const date = parseTallyDate(pickTag(v, 'DATE'))
    if (!vchNumber || !date) continue
    const partyName = pickTag(v, 'PARTYLEDGERNAME').toLowerCase()
    // Find every ALLLEDGERENTRIES.LIST and scan their BILLALLOCATIONS.LIST.
    // We only care about the party's ledger entry — but the easiest, most
    // robust check is: does the voucher have ANY BILLALLOCATIONS with
    // BILLTYPE=Agst Ref pointing at a sales/CN reference? If yes, the
    // user has done the bill-wise work in Tally.
    const ledgerBlocks = v.match(/<ALLLEDGERENTRIES\.LIST[^>]*>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g) || []
    let hasAgstRef = false
    let hasOnAccount = false
    let billCount = 0
    for (const lb of ledgerBlocks) {
      const lname = pickTag(lb, 'LEDGERNAME').toLowerCase()
      // Bank lines (HDFC, ICICI, etc.) don't carry party bills. Only
      // examine entries that match the receipt's party ledger.
      if (partyName && lname !== partyName) continue
      const bills = lb.match(/<BILLALLOCATIONS\.LIST[^>]*>[\s\S]*?<\/BILLALLOCATIONS\.LIST>/g) || []
      for (const bb of bills) {
        billCount++
        const t = pickTag(bb, 'BILLTYPE')
        if (t === 'Agst Ref') hasAgstRef = true
        else if (t === 'On Account') hasOnAccount = true
      }
    }
    out.push({ vchNumber, date, hasAgstRef, hasOnAccount, billCount })
  }
  return out
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const from = body.from || '2025-04-01'
  const to = body.to || new Date().toISOString().slice(0, 10)
  const dryRun = body.dryRun === true

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  const windows = monthlyWindows(from, to)
  const classified: ClassifiedReceipt[] = []
  for (const w of windows) {
    let res: Response
    try {
      res = await fetch(tunnelUrl, {
        method: 'POST', headers,
        body: buildReceiptRegisterXML(fmtTallyDate(w.from), fmtTallyDate(w.to)),
      })
    } catch (e: any) {
      return NextResponse.json({ error: `Tally tunnel unreachable in ${w.from}–${w.to}: ${e?.message || 'network error'}` }, { status: 502 })
    }
    if (!res.ok) return NextResponse.json({ error: `Tally HTTP ${res.status} in ${w.from}–${w.to}` }, { status: 502 })
    const xml = await res.text()
    classified.push(...classifyReceipts(xml))
  }

  // Match Tally classification → our DB by natural key.
  const db = prisma as any
  const billWise = classified.filter(c => c.hasAgstRef)
  const onAccountOnly = classified.filter(c => !c.hasAgstRef && c.billCount === 0)

  // Bulk lookup. We match by (vchNumber, date, vchType='Receipt'); date
  // is stored as midnight UTC after Tally sync so comparing the day
  // boundary is safe.
  let updated = 0
  let alreadyStamped = 0
  let notFound = 0
  const updatedRows: { id: number; vchNumber: string; date: string }[] = []
  for (const c of billWise) {
    const dayStart = new Date(c.date.getFullYear(), c.date.getMonth(), c.date.getDate())
    const dayEnd = new Date(c.date.getFullYear(), c.date.getMonth(), c.date.getDate() + 1)
    const match = await db.ksiHdfcReceipt.findFirst({
      where: {
        vchNumber: c.vchNumber, vchType: 'Receipt', direction: 'in',
        date: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, vchNumber: true, date: true, tallyPushedAt: true },
    })
    if (!match) { notFound++; continue }
    if (match.tallyPushedAt) { alreadyStamped++; continue }
    if (!dryRun) {
      await db.ksiHdfcReceipt.update({ where: { id: match.id }, data: { tallyPushedAt: new Date() } })
    }
    updated++
    updatedRows.push({ id: match.id, vchNumber: match.vchNumber, date: match.date.toISOString().slice(0, 10) })
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    range: { from, to },
    tally: {
      total: classified.length,
      billWise: billWise.length,
      onAccountOnly: onAccountOnly.length,
    },
    stamped: { updated, alreadyStamped, notFound },
    updatedSample: updatedRows.slice(0, 20),
  })
}
