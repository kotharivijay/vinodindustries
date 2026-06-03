export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any
const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'

// Mirror the sales-sync types & helpers (kept in-file to avoid creating a
// shared lib for this one feature). Any change to SALES_TYPES in
// ksi-sales-sync MUST be mirrored here or the prune will misreport
// orphans.
const SALES_TYPES = ['Process Job', 'Sales', 'Credit Note', 'Journal', 'Debit Note']

const pad = (n: number) => String(n).padStart(2, '0')
function fmtTallyDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function parseTallyDate(s: string): Date | null {
  const t = s.trim()
  if (/^\d{8}$/.test(t)) return new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00`)
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d
}
const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
function pickTag(block: string, tag: string): string {
  return dec(block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] || '')
}

function buildXML(fromDDMMYYYY: string, toDDMMYYYY: string, vchType: string): string {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Voucher Register</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY><SVFROMDATE>${fromDDMMYYYY}</SVFROMDATE><SVTODATE>${toDDMMYYYY}</SVTODATE><VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME></STATICVARIABLES></DESC></BODY></ENVELOPE>`
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
    out.push({ from: isoDay(winStart), to: isoDay(realEnd) })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }
  return out
}

/**
 * POST /api/tally/ksi-sales-prune  Body: { from?, to?, dryRun? }
 *
 * Reconciles Tally-side deletions. Pulls every voucher's natural key
 * (vchNumber, vchType, date) from Tally's Voucher Register for the
 * requested range, compares against KsiSalesInvoice rows in that same
 * range (excluding isOpeningBalance), and deletes the orphans (DB rows
 * that no longer exist in Tally).
 *
 * Safety:
 *  - skipped window/type combos (where Tally returned ZERO vouchers) are
 *    treated as "could not verify" — rows in that window/type combo are
 *    excluded from deletion to prevent a transient empty response from
 *    nuking the month
 *  - isOpeningBalance rows are excluded — they don't exist in Tally by
 *    design
 *  - dryRun=true returns the orphan list without touching the DB
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const from: string = body.from || '2025-04-01'
  const to: string = body.to || new Date().toISOString().slice(0, 10)
  const dryRun: boolean = body.dryRun !== false // default to dryRun for safety

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = process.env.TALLY_API_SECRET
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  const windows = monthlyWindows(from, to)
  const tallyKeys = new Set<string>() // `${vchType}|${vchNumber}|${YYYY-MM-DD}`
  const verifiedWindows: Array<{ from: string; to: string; vchType: string; count: number }> = []
  const unverifiedWindows: Array<{ from: string; to: string; vchType: string; reason: string }> = []

  for (const w of windows) {
    for (const vt of SALES_TYPES) {
      let res: Response
      try {
        res = await fetch(tunnelUrl, {
          method: 'POST',
          headers,
          body: buildXML(fmtTallyDate(w.from), fmtTallyDate(w.to), vt),
        })
      } catch (e: any) {
        unverifiedWindows.push({ from: w.from, to: w.to, vchType: vt, reason: `tunnel error: ${e?.message || 'network'}` })
        continue
      }
      if (!res.ok) {
        unverifiedWindows.push({ from: w.from, to: w.to, vchType: vt, reason: `HTTP ${res.status}` })
        continue
      }
      const xml = await res.text()
      const blocks = xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
      if (blocks.length === 0) {
        // Tally returned an empty body for this slot. Could be genuinely
        // empty OR a soft failure. Treat as unverified.
        unverifiedWindows.push({ from: w.from, to: w.to, vchType: vt, reason: 'zero vouchers (treated as unverified)' })
        continue
      }
      let added = 0
      for (const b of blocks) {
        const vchNumber = pickTag(b, 'VOUCHERNUMBER')
        const vchType = pickTag(b, 'VOUCHERTYPENAME')
        const date = parseTallyDate(pickTag(b, 'DATE'))
        if (!vchNumber || !vchType || !date) continue
        tallyKeys.add(`${vchType}|${vchNumber}|${isoDay(date)}`)
        added++
      }
      verifiedWindows.push({ from: w.from, to: w.to, vchType: vt, count: added })
    }
  }

  // Build set of (vchType, fromISO, toISO) combos that ARE verified, so
  // we can filter DB rows accordingly.
  const verifiedRanges = new Map<string, Array<{ from: string; to: string }>>()
  for (const v of verifiedWindows) {
    if (!verifiedRanges.has(v.vchType)) verifiedRanges.set(v.vchType, [])
    verifiedRanges.get(v.vchType)!.push({ from: v.from, to: v.to })
  }

  // Pull DB rows for the full range, then filter to only those whose
  // (vchType, date) sits inside a VERIFIED window before considering
  // them for deletion.
  const dbRows: any[] = await db.ksiSalesInvoice.findMany({
    where: {
      isOpeningBalance: false,
      vchType: { in: SALES_TYPES },
      date: { gte: new Date(from + 'T00:00:00'), lte: new Date(to + 'T23:59:59') },
    },
    select: { id: true, vchNumber: true, vchType: true, date: true, totalAmount: true, partyName: true },
  })

  const orphans: Array<{ id: number; vchNumber: string; vchType: string; date: string; totalAmount: number; partyName: string }> = []
  for (const r of dbRows) {
    const dISO = isoDay(r.date)
    // Is this row inside a verified Tally window for its type?
    const ranges = verifiedRanges.get(r.vchType) || []
    const inVerifiedRange = ranges.some(rg => dISO >= rg.from && dISO <= rg.to)
    if (!inVerifiedRange) continue // can't verify => can't safely delete
    const key = `${r.vchType}|${r.vchNumber}|${dISO}`
    if (!tallyKeys.has(key)) {
      orphans.push({
        id: r.id,
        vchNumber: r.vchNumber,
        vchType: r.vchType,
        date: dISO,
        totalAmount: r.totalAmount,
        partyName: r.partyName,
      })
    }
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      range: { from, to },
      tallyVouchers: tallyKeys.size,
      dbRowsInRange: dbRows.length,
      orphanCount: orphans.length,
      orphans,
      verifiedWindows,
      unverifiedWindows,
    })
  }

  if (orphans.length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun: false,
      range: { from, to },
      deletedCount: 0,
      orphanCount: 0,
      verifiedWindows,
      unverifiedWindows,
    })
  }

  const result = await db.ksiSalesInvoice.deleteMany({
    where: { id: { in: orphans.map(o => o.id) } },
  })

  return NextResponse.json({
    ok: true,
    dryRun: false,
    range: { from, to },
    deletedCount: result.count,
    orphanCount: orphans.length,
    deleted: orphans,
    verifiedWindows,
    unverifiedWindows,
  })
}
