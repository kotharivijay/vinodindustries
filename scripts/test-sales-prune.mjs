// Mirror the /api/tally/ksi-sales-prune logic in dryRun mode for one
// small range so we can validate the diff before exposing the UI.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const TUNNEL = process.env.TALLY_TUNNEL_URL
const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'
const SALES_TYPES = ['Process Job', 'Sales', 'Credit Note', 'Journal', 'Debit Note']

const FROM = process.argv[2] || '2026-05-01'
const TO = process.argv[3] || '2026-05-31'

const headers = { 'Content-Type': 'text/xml' }
if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

const pad = (n) => String(n).padStart(2, '0')
const fmtTallyDate = (iso) => {
  const d = new Date(iso + 'T00:00:00')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
const pickTag = (b, t) => dec(b.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`))?.[1] || '')
const parseTallyDate = (s) => {
  const t = s.trim()
  if (/^\d{8}$/.test(t)) return new Date(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T00:00:00`)
  const d = new Date(t); return isNaN(d.getTime()) ? null : d
}

const buildXml = (from, to, vt) => `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Voucher Register</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY><SVFROMDATE>${from}</SVFROMDATE><SVTODATE>${to}</SVTODATE><VOUCHERTYPENAME>${vt}</VOUCHERTYPENAME></STATICVARIABLES></DESC></BODY></ENVELOPE>`

const tallyKeys = new Set()
const verified = []
const unverified = []
console.log(`Range: ${FROM} → ${TO}\n`)
for (const vt of SALES_TYPES) {
  let res
  try {
    res = await fetch(TUNNEL, { method: 'POST', headers, body: buildXml(fmtTallyDate(FROM), fmtTallyDate(TO), vt) })
  } catch (e) {
    unverified.push({ vt, reason: `tunnel: ${e.message}` })
    continue
  }
  if (!res.ok) { unverified.push({ vt, reason: `HTTP ${res.status}` }); continue }
  const xml = await res.text()
  const blocks = xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
  if (blocks.length === 0) { unverified.push({ vt, reason: 'zero vouchers' }); continue }
  let added = 0
  for (const b of blocks) {
    const vchNumber = pickTag(b, 'VOUCHERNUMBER')
    const vchType = pickTag(b, 'VOUCHERTYPENAME')
    const date = parseTallyDate(pickTag(b, 'DATE'))
    if (!vchNumber || !vchType || !date) continue
    tallyKeys.add(`${vchType}|${vchNumber}|${isoDay(date)}`)
    added++
  }
  verified.push({ vt, count: added })
  console.log(`  ${vt.padEnd(13)} ${added} vouchers`)
}

console.log(`\nVerified types: ${verified.length}`)
console.log(`Unverified types: ${unverified.length}`)
for (const u of unverified) console.log(`  ${u.vt}: ${u.reason}`)

// Window-level verification (matches the live routes): a window is
// pruneable if ANY vchType returned >=1 voucher in it.
const verifiedWindow = verified.length > 0
const dbRows = await prisma.ksiSalesInvoice.findMany({
  where: {
    isOpeningBalance: false,
    vchType: { in: SALES_TYPES },
    date: { gte: new Date(FROM + 'T00:00:00'), lte: new Date(TO + 'T23:59:59') },
  },
  select: { id: true, vchNumber: true, vchType: true, date: true, totalAmount: true, partyName: true },
})

const orphans = []
for (const r of dbRows) {
  if (!verifiedWindow) continue
  const k = `${r.vchType}|${r.vchNumber}|${isoDay(r.date)}`
  if (!tallyKeys.has(k)) orphans.push(r)
}

console.log(`\nDB rows in range: ${dbRows.length}`)
console.log(`Tally vouchers: ${tallyKeys.size}`)
console.log(`Orphans (in DB, missing from Tally): ${orphans.length}\n`)
for (const o of orphans.slice(0, 30)) {
  console.log(`  [${o.id}] ${isoDay(o.date)}  ${o.vchType.padEnd(13)}  ${o.vchNumber.padEnd(18)}  ₹${o.totalAmount.toFixed(2).padStart(11)}  ${o.partyName}`)
}
if (orphans.length > 30) console.log(`  ... and ${orphans.length - 30} more`)

await prisma.$disconnect()
