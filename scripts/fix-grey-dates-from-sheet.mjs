// Re-derive GreyEntry.date from the current grey sheet (INWERD GRAY).
//
// Sheet col C (Date) is ambiguous between DD/MM/YY and MM/DD/YY when both
// numbers ≤ 12. Col B holds the explicit month — use it as source of truth.
// Matches sheet rows to GreyEntry by SN (col A → GreyEntry.sn).
//
// Run dry first: node scripts/fix-grey-dates-from-sheet.mjs
// Apply changes: node scripts/fix-grey-dates-from-sheet.mjs --apply
import { PrismaClient } from '@prisma/client'
import { GoogleAuth } from 'google-auth-library'

const APPLY = process.argv.includes('--apply')
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1FkDEA84AWJxHBMTX7ku67TRdIo-GP1VMOzO_3ZOUVMo'
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'INWERD GRAY'

async function readSheet() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing')
  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  const range = encodeURIComponent(`'${SHEET_NAME}'!A3:R`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } })
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`)
  return (await res.json()).values || []
}

function parseRawDate(s) {
  if (!s) return null
  const parts = String(s).split('/').map(p => p.trim())
  if (parts.length !== 3) return null
  const a = parseInt(parts[0], 10)
  const b = parseInt(parts[1], 10)
  let y = parseInt(parts[2], 10)
  if (isNaN(a) || isNaN(b) || isNaN(y)) return null
  if (y < 100) y = 2000 + y
  return { a, b, y }
}

/**
 * Resolve M/D vs D/M by comparing against col-B month.
 * Returns ISO YYYY-MM-DD or null.
 */
function deriveDate(rawDate, expectedMonth) {
  const parsed = parseRawDate(rawDate)
  if (!parsed) return null
  const { a, b, y } = parsed
  let month, day
  if (a === expectedMonth) { month = a; day = b }
  else if (b === expectedMonth) { month = b; day = a }
  else { month = a; day = b }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

const prisma = new PrismaClient()
async function main() {
  console.log('Reading grey sheet…')
  const rows = await readSheet()
  console.log(`  ${rows.length} rows\n`)

  // Map<sn, derived ISO>
  const sheetDates = new Map()
  let parseFailed = 0, noMonth = 0, noSn = 0
  for (const r of rows) {
    const snRaw = (r[0] || '').toString().trim()
    const sn = parseInt(snRaw, 10)
    if (!sn) { noSn++; continue }
    const monthRaw = (r[1] || '').toString().trim()
    const expectedMonth = parseInt(monthRaw, 10)
    if (!expectedMonth || expectedMonth < 1 || expectedMonth > 12) { noMonth++; continue }
    const iso = deriveDate(r[2], expectedMonth)
    if (!iso) { parseFailed++; continue }
    sheetDates.set(sn, iso)
  }
  console.log(`Sheet rows producing a date: ${sheetDates.size} (skipped ${parseFailed} unparseable, ${noMonth} no month, ${noSn} no SN)\n`)

  const greys = await prisma.greyEntry.findMany({
    select: { id: true, sn: true, lotNo: true, date: true, challanNo: true, party: { select: { name: true } } },
    where: { sn: { not: null } },
  })
  console.log(`GreyEntry rows with SN in DB: ${greys.length}\n`)

  const toUpdate = []
  const noChange = []
  const noSheetMatch = []
  for (const g of greys) {
    const iso = sheetDates.get(g.sn)
    if (!iso) { noSheetMatch.push(g); continue }
    const currentIso = g.date ? g.date.toISOString().slice(0, 10) : null
    if (currentIso === iso) noChange.push(g)
    else toUpdate.push({ g, currentIso, newIso: iso })
  }
  console.log(`Already correct:          ${noChange.length}`)
  console.log(`No matching sheet row:    ${noSheetMatch.length}`)
  console.log(`Will update:              ${toUpdate.length}\n`)

  if (toUpdate.length > 0) {
    console.log('Sample updates (first 20):')
    toUpdate.slice(0, 20).forEach(({ g, currentIso, newIso }) => {
      console.log(`  SN ${String(g.sn).padEnd(5)} ${(g.lotNo || '').padEnd(14)} ${(currentIso || '—').padEnd(11)} → ${newIso}  ${(g.party?.name || '').slice(0, 30)}`)
    })
    if (toUpdate.length > 20) console.log(`  …and ${toUpdate.length - 20} more`)
  }

  if (!APPLY) { console.log('\n(dry run — re-run with --apply to write changes)'); return }

  console.log('\nApplying…')
  let ok = 0, fail = 0
  for (const u of toUpdate) {
    try {
      await prisma.greyEntry.update({
        where: { id: u.g.id },
        data: { date: new Date(u.newIso + 'T00:00:00.000Z') },
      })
      ok++
    } catch (e) { fail++; console.error(`  FAIL SN ${u.g.sn}: ${e.message}`) }
  }
  console.log(`Done: ${ok} updated, ${fail} failed`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
