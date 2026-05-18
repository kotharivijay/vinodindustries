// Tally-authoritative drift fix. For every KsiSalesInvoice + KsiHdfcReceipt
// row whose partyName disagrees with its canonical form (TallyLedger name),
// re-query Tally's Voucher Register for that exact voucher and write whatever
// Tally currently reports as PARTYLEDGERNAME. No assumptions baked in — if
// Tally has been renamed again, we follow.
//
// USAGE
//   node scripts/refresh-partyname-from-tally.mjs           # dry-run
//   node scripts/refresh-partyname-from-tally.mjs --apply   # write updates
//
// Re-runnable + idempotent (a clean run finds zero rows to update).
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'
const canon = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const pad = (n) => String(n).padStart(2, '0')
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
const fmtTallyDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`

const TUNNEL = process.env.TALLY_TUNNEL_URL
if (!TUNNEL) { console.error('TALLY_TUNNEL_URL missing'); process.exit(1) }
const headers = { 'Content-Type': 'text/xml' }
if (process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = process.env.TALLY_API_SECRET
if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

function buildXml(fromDDMMYYYY, toDDMMYYYY, vchType) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Voucher Register</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY><SVFROMDATE>${fromDDMMYYYY}</SVFROMDATE><SVTODATE>${toDDMMYYYY}</SVTODATE><VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME></STATICVARIABLES></DESC></BODY></ENVELOPE>`
}

function pickTag(block, tag) {
  return dec(block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] || '')
}

async function fetchPartyForVoucher({ vchNumber, vchType, date }) {
  // Query a one-day window so the XML stays small. Tally's Voucher Register
  // filters by VOUCHERTYPENAME so we use the row's type to scope the call.
  const dd = fmtTallyDate(date)
  const res = await fetch(TUNNEL, {
    method: 'POST',
    headers,
    body: buildXml(dd, dd, vchType),
  })
  if (!res.ok) throw new Error(`Tally HTTP ${res.status}`)
  const xml = await res.text()
  const blocks = xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
  for (const b of blocks) {
    const vn = pickTag(b, 'VOUCHERNUMBER')
    if (vn !== vchNumber) continue
    return pickTag(b, 'PARTYLEDGERNAME') || pickTag(b, 'PARTYNAME') || null
  }
  return null
}

// 1. Find drift rows (raw partyName whose canonical form has >1 spelling
//    across the table). For each, the "fresh from Tally" name will replace
//    whatever's stored.
const invs = await db.ksiSalesInvoice.findMany({
  select: { id: true, vchNumber: true, vchType: true, date: true, partyName: true },
})
const rcpts = await db.ksiHdfcReceipt.findMany({
  where: { hidden: false },
  select: { id: true, vchNumber: true, vchType: true, date: true, partyName: true },
})

// Build canonical-key → set of raw spellings (across both tables) so we know
// which canonical groups have drift. Any row in a drift group is a candidate.
const rawsByCanon = new Map()
for (const r of [...invs, ...rcpts]) {
  const k = canon(r.partyName)
  if (!rawsByCanon.has(k)) rawsByCanon.set(k, new Set())
  rawsByCanon.get(k).add(r.partyName)
}
const driftCanons = new Set([...rawsByCanon.entries()].filter(([, s]) => s.size > 1).map(([k]) => k))

const invCands = invs.filter(r => driftCanons.has(canon(r.partyName)))
const rcptCands = rcpts.filter(r => driftCanons.has(canon(r.partyName)))

console.log(`\nMode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (read-only)'}`)
console.log(`Candidate invoices: ${invCands.length} · receipts: ${rcptCands.length}\n`)

let updInv = 0, updRcpt = 0, skipped = 0
for (const r of invCands) {
  let fresh
  try { fresh = await fetchPartyForVoucher(r) } catch (e) {
    console.log(`  ! INV ${r.vchType} ${r.vchNumber} ${r.date.toISOString().slice(0, 10)} — Tally error: ${e.message}`)
    skipped++; continue
  }
  if (!fresh) {
    console.log(`  ? INV ${r.vchType} ${r.vchNumber} ${r.date.toISOString().slice(0, 10)} — not found in Tally`)
    skipped++; continue
  }
  if (fresh === r.partyName) continue // already aligned, no-op
  console.log(`  INV ${r.vchType} ${r.vchNumber}  ${r.date.toISOString().slice(0, 10)}`)
  console.log(`     was: "${r.partyName}"`)
  console.log(`     now: "${fresh}"`)
  if (APPLY) {
    await db.ksiSalesInvoice.update({ where: { id: r.id }, data: { partyName: fresh } })
  }
  updInv++
}
for (const r of rcptCands) {
  let fresh
  try { fresh = await fetchPartyForVoucher(r) } catch (e) {
    console.log(`  ! RCPT ${r.vchType} ${r.vchNumber} ${r.date.toISOString().slice(0, 10)} — Tally error: ${e.message}`)
    skipped++; continue
  }
  if (!fresh) {
    console.log(`  ? RCPT ${r.vchType} ${r.vchNumber} ${r.date.toISOString().slice(0, 10)} — not found in Tally`)
    skipped++; continue
  }
  if (fresh === r.partyName) continue
  console.log(`  RCPT ${r.vchType} ${r.vchNumber}  ${r.date.toISOString().slice(0, 10)}`)
  console.log(`     was: "${r.partyName}"`)
  console.log(`     now: "${fresh}"`)
  if (APPLY) {
    await db.ksiHdfcReceipt.update({ where: { id: r.id }, data: { partyName: fresh } })
  }
  updRcpt++
}

console.log(`\n${APPLY ? 'Updated' : 'Would update'}: ${updInv} invoice(s), ${updRcpt} receipt(s).${skipped ? `  Skipped ${skipped}.` : ''}\n`)
await db.$disconnect()
