export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any
const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'

const canon = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const pad = (n: number) => String(n).padStart(2, '0')
const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
function fmtTallyDate(d: Date) { return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` }
function isoDay(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function buildXml(fromDDMMYYYY: string, toDDMMYYYY: string, vchType: string) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Voucher Register</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY><SVFROMDATE>${fromDDMMYYYY}</SVFROMDATE><SVTODATE>${toDDMMYYYY}</SVTODATE><VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME></STATICVARIABLES></DESC></BODY></ENVELOPE>`
}

function pickTag(block: string, tag: string) {
  return dec(block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] || '')
}

/**
 * Diagnose + (optionally) repair partyName drift in cached voucher rows.
 *
 * "Drift" means two raw spellings in our DB collapse to the same canonical
 * form (whitespace + case folded). Each affected row gets a one-day Voucher
 * Register call to Tally for its vchType; the live PARTYLEDGERNAME from
 * Tally replaces our stored value. Tally is authoritative — if it's been
 * renamed again, we follow.
 *
 * POST body: { apply?: boolean }
 *   apply=false (default): returns { plan, counts, alreadyAligned, skipped }
 *   apply=true:            returns { result: { invUpdated, rcptUpdated, skipped }, plan }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) {
    return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured', code: 'NO_TUNNEL' }, { status: 500 })
  }
  const body = await req.json().catch(() => ({}))
  const apply = body.apply === true

  // Pull every partyName in scope so we can detect drift across both tables.
  const [invs, rcpts] = await Promise.all([
    db.ksiSalesInvoice.findMany({
      select: { id: true, vchNumber: true, vchType: true, date: true, partyName: true },
    }),
    db.ksiHdfcReceipt.findMany({
      where: { hidden: false },
      select: { id: true, vchNumber: true, vchType: true, date: true, partyName: true },
    }),
  ])

  const rawsByCanon = new Map<string, Set<string>>()
  for (const r of [...invs, ...rcpts] as any[]) {
    const k = canon(r.partyName)
    if (!rawsByCanon.has(k)) rawsByCanon.set(k, new Set())
    rawsByCanon.get(k)!.add(r.partyName)
  }
  const driftCanons = new Set([...rawsByCanon.entries()].filter(([, s]) => s.size > 1).map(([k]) => k))

  if (driftCanons.size === 0) {
    return NextResponse.json({
      ok: true,
      apply,
      plan: [],
      counts: { candidates: 0, willUpdate: 0, alreadyAligned: 0, skipped: 0 },
      message: 'No drift detected. All party names match across cached vouchers.',
    })
  }

  const invCands: any[] = invs.filter((r: any) => driftCanons.has(canon(r.partyName)))
  const rcptCands: any[] = rcpts.filter((r: any) => driftCanons.has(canon(r.partyName)))

  // One Tally call per (vchType, dateISO) — covers every same-day voucher of
  // that type without firing one round-trip per row. Keeps the modal preview
  // fast even when drift spans many vouchers.
  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = process.env.TALLY_API_SECRET
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  const cache = new Map<string, Map<string, string>>() // key=`${vchType}|${isoDay}`, value=Map<vchNumber, partyName>
  async function loadDay(vchType: string, date: Date): Promise<Map<string, string> | null> {
    const key = `${vchType}|${isoDay(date)}`
    if (cache.has(key)) return cache.get(key)!
    let res: Response
    try {
      res = await fetch(tunnelUrl!, {
        method: 'POST',
        headers,
        body: buildXml(fmtTallyDate(date), fmtTallyDate(date), vchType),
      })
    } catch { return null }
    if (!res.ok) return null
    const xml = await res.text()
    const blocks = xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
    const m = new Map<string, string>()
    for (const b of blocks) {
      const vn = pickTag(b, 'VOUCHERNUMBER')
      const pn = pickTag(b, 'PARTYLEDGERNAME') || pickTag(b, 'PARTYNAME')
      if (vn && pn) m.set(vn, pn)
    }
    cache.set(key, m)
    return m
  }

  type PlanRow = { table: 'inv' | 'rcpt'; id: number; vchNumber: string; vchType: string; date: string; was: string; now: string }
  const plan: PlanRow[] = []
  let alreadyAligned = 0
  const skipped: { table: string; vchNumber: string; vchType: string; date: string; reason: string }[] = []

  async function resolveOne(table: 'inv' | 'rcpt', r: any) {
    const day = await loadDay(r.vchType, r.date)
    if (!day) {
      skipped.push({ table, vchNumber: r.vchNumber, vchType: r.vchType, date: isoDay(r.date), reason: 'tally_unreachable' })
      return
    }
    const fresh = day.get(r.vchNumber)
    if (!fresh) {
      skipped.push({ table, vchNumber: r.vchNumber, vchType: r.vchType, date: isoDay(r.date), reason: 'voucher_not_found_in_tally' })
      return
    }
    if (fresh === r.partyName) { alreadyAligned++; return }
    plan.push({ table, id: r.id, vchNumber: r.vchNumber, vchType: r.vchType, date: isoDay(r.date), was: r.partyName, now: fresh })
  }

  for (const r of invCands) await resolveOne('inv', r)
  for (const r of rcptCands) await resolveOne('rcpt', r)

  if (!apply) {
    return NextResponse.json({
      ok: true,
      apply: false,
      plan,
      counts: {
        candidates: invCands.length + rcptCands.length,
        willUpdate: plan.length,
        alreadyAligned,
        skipped: skipped.length,
      },
      skipped,
    })
  }

  let invUpdated = 0, rcptUpdated = 0
  for (const p of plan) {
    if (p.table === 'inv') {
      await db.ksiSalesInvoice.update({ where: { id: p.id }, data: { partyName: p.now } })
      invUpdated++
    } else {
      await db.ksiHdfcReceipt.update({ where: { id: p.id }, data: { partyName: p.now } })
      rcptUpdated++
    }
  }

  return NextResponse.json({
    ok: true,
    apply: true,
    plan,
    counts: { candidates: invCands.length + rcptCands.length, willUpdate: plan.length, alreadyAligned, skipped: skipped.length },
    result: { invUpdated, rcptUpdated, skipped: skipped.length },
    skipped,
  })
}
