export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any
const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'

const pad = (n: number) => String(n).padStart(2, '0')
const fmtTallyDate = (iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
const pickTag = (b: string, t: string): string => dec(b.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`))?.[1] || '')
const parseAmt = (s: string): number => parseFloat((s || '0').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0
const parseTallyDate = (s: string): Date | null => {
  const t = s.trim()
  if (/^\d{8}$/.test(t)) return new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00`)
  return null
}

/**
 * POST /api/tally/backfill-journal-direction  Body: { from, to }
 *
 * For the chosen date range, re-fetches Journal vouchers from Tally and
 * sets KsiSalesInvoice.journalDirection based on the party leg's signed
 * amount (negative => Dr, positive => Cr). Idempotent: rows where the
 * direction is already correct are skipped.
 *
 * Designed to be called month-by-month from the client (Settings card)
 * so each call stays well inside the Vercel function timeout.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const from: string = body.from
  const to: string = body.to
  if (!from || !to) return NextResponse.json({ error: 'from and to required (YYYY-MM-DD)' }, { status: 400 })

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = process.env.TALLY_API_SECRET
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Voucher Register</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY><SVFROMDATE>${fmtTallyDate(from)}</SVFROMDATE><SVTODATE>${fmtTallyDate(to)}</SVTODATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME></STATICVARIABLES></DESC></BODY></ENVELOPE>`
  let res: Response
  try {
    res = await fetch(tunnelUrl, { method: 'POST', headers, body: xml })
  } catch (e: any) {
    return NextResponse.json({ error: `Tally tunnel unreachable: ${e?.message || 'network'}` }, { status: 502 })
  }
  if (!res.ok) return NextResponse.json({ error: `Tally HTTP ${res.status}` }, { status: 502 })

  const text = await res.text()
  const blocks = text.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []

  // Pre-fetch DB Journal rows for this window so we can lookup by natural key.
  const dbRows: any[] = await db.ksiSalesInvoice.findMany({
    where: {
      vchType: 'Journal',
      date: { gte: new Date(from + 'T00:00:00'), lte: new Date(to + 'T23:59:59') },
    },
    select: { id: true, vchNumber: true, date: true, partyName: true, journalDirection: true },
  })
  const dbByKey = new Map<string, any>()
  for (const r of dbRows) dbByKey.set(`${r.vchNumber}|${isoDay(r.date)}`, r)

  let updated = 0, drCount = 0, crCount = 0, skippedAlreadyCorrect = 0, skippedNoMatch = 0
  for (const b of blocks) {
    const vchNumber = pickTag(b, 'VOUCHERNUMBER')
    const date = parseTallyDate(pickTag(b, 'DATE'))
    if (!vchNumber || !date) continue
    const dbRow = dbByKey.get(`${vchNumber}|${isoDay(date)}`)
    if (!dbRow) continue
    const legs = b.match(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g)
      || b.match(/<LEDGERENTRIES\.LIST>[\s\S]*?<\/LEDGERENTRIES\.LIST>/g) || []
    let partyAmt: number | null = null
    for (const leg of legs) {
      const name = pickTag(leg, 'LEDGERNAME')
      if (name.toLowerCase() === dbRow.partyName.toLowerCase()) {
        partyAmt = (partyAmt ?? 0) + parseAmt(pickTag(leg, 'AMOUNT'))
      }
    }
    if (partyAmt == null) { skippedNoMatch++; continue }
    const dir = partyAmt < 0 ? 'Dr' : 'Cr'
    if (dbRow.journalDirection === dir) { skippedAlreadyCorrect++; continue }
    await db.ksiSalesInvoice.update({ where: { id: dbRow.id }, data: { journalDirection: dir } })
    updated++
    if (dir === 'Dr') drCount++; else crCount++
  }

  return NextResponse.json({
    ok: true,
    range: { from, to },
    tallyJournals: blocks.length,
    dbRows: dbRows.length,
    updated, drCount, crCount, skippedAlreadyCorrect, skippedNoMatch,
  })
}
