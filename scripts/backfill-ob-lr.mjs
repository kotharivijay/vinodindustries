// Backfill LotOpeningBalance.lrNo from the historical grey sheet.
// The grey sheet (INWERD GRAY) still holds last-year inward rows with
// Transport LR no in col K. OB lot numbers in DB have a "0" suffix or
// renames applied — we mirror that transformation when matching.
//
// Run dry first: node scripts/backfill-ob-lr.mjs
// Apply changes: node scripts/backfill-ob-lr.mjs --apply
import { PrismaClient } from '@prisma/client'
import { GoogleAuth } from 'google-auth-library'

const APPLY = process.argv.includes('--apply')
// Two sources of truth — try the current grey sheet first (lot numbers
// already have the "0" suffix), then the last-year carry-forward sheet
// (lots are pre-rename, so we apply transformLotNo before matching).
const CURRENT_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1FkDEA84AWJxHBMTX7ku67TRdIo-GP1VMOzO_3ZOUVMo'
const CURRENT_SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'INWERD GRAY'
const LAST_YEAR_SHEET_ID = '1AGOnIxF5HYZSJuD3Hs4_e5NDfS7gL_zVd-AkQdvF9UA'

// Same rename map as carry-forward import
const CARRY_FORWARD_RENAMES = {
  'YC-773': 'YC-7730',
  'PS-823': 'PS-8230',
  'AJ-1212': 'AJ-12120',
  'PS-1223': 'PS-12230',
  'PS-1224': 'PS-12240',
  'PS-1227': 'PS-12270',
  'PS-1228': 'PS-12280',
  'PS-1229': 'PS-12290',
  'PS-1242': 'PS-12420',
  'PS-1246': 'PS-12460',
  'SSF-1260': 'SSF-12600',
  'AJ-1264': 'AJ-12640',
}

function transformLotNo(raw) {
  const renameKey = Object.keys(CARRY_FORWARD_RENAMES).find(k => k.toLowerCase() === raw.toLowerCase())
  let lotNo = renameKey ? CARRY_FORWARD_RENAMES[renameKey] : raw
  if (!renameKey && lotNo) lotNo = lotNo + '0'
  return lotNo
}

async function readSheet(sheetId, sheetName, range) {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing')
  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  const fullRange = sheetName ? `'${sheetName}'!${range}` : range
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(fullRange)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } })
  if (!res.ok) throw new Error(`Sheet ${sheetId} HTTP ${res.status}`)
  const data = await res.json()
  return data.values || []
}

function parseSheetDate(s) {
  if (!s) return null
  const parts = String(s).split('/')
  if (parts.length !== 3) return null
  let m = parseInt(parts[0]), d = parseInt(parts[1]), y = parseInt(parts[2])
  if (y < 100) y = 2000 + y
  // Sheet uses M/D/YY
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null
  return new Date(y, m - 1, d)
}

const prisma = new PrismaClient()
async function main() {
  const obs = await prisma.lotOpeningBalance.findMany({
    select: { id: true, lotNo: true, lrNo: true, party: true, openingThan: true, greyDate: true },
  })
  const missing = obs.filter(o => !o.lrNo)
  console.log(`OB rows total: ${obs.length}, missing lrNo: ${missing.length}\n`)
  if (missing.length === 0) return console.log('Nothing to do.')

  // ── Pass 1: current grey sheet (lots already have "0" suffix, no transform)
  console.log('Reading current grey sheet…')
  const curRows = await readSheet(CURRENT_SHEET_ID, CURRENT_SHEET_NAME, 'A3:R')
  console.log(`  ${curRows.length} rows`)
  const sheetMap = new Map()
  let curWithLr = 0
  for (const r of curRows) {
    const lot = (r[16] || '').trim()
    if (!lot) continue
    const lr = (r[10] || '').trim()
    if (!lr) continue
    curWithLr++
    if (!sheetMap.has(lot)) sheetMap.set(lot, { lr, date: parseSheetDate(r[2]), originalLot: lot, source: 'current' })
  }
  console.log(`  with LR: ${curWithLr}, unique lots: ${sheetMap.size}`)

  // ── Pass 2: last-year sheet (apply transformLotNo to add "0" suffix)
  console.log('Reading last-year sheet…')
  const lyRows = await readSheet(LAST_YEAR_SHEET_ID, null, 'A4:R')
  console.log(`  ${lyRows.length} rows`)
  let lyAdded = 0, lyWithLr = 0
  for (const r of lyRows) {
    const rawLot = (r[16] || '').trim()
    if (!rawLot) continue
    const lr = (r[10] || '').trim()
    if (!lr) continue
    lyWithLr++
    const t = transformLotNo(rawLot)
    if (!sheetMap.has(t)) {
      sheetMap.set(t, { lr, date: parseSheetDate(r[2]), originalLot: rawLot, source: 'last-year' })
      lyAdded++
    }
  }
  console.log(`  with LR: ${lyWithLr}, added ${lyAdded} new lots, total unique lots in map: ${sheetMap.size}\n`)

  const matched = []
  const stillMissing = []
  for (const ob of missing) {
    const hit = sheetMap.get(ob.lotNo)
    if (hit) matched.push({ ob, ...hit })
    else stillMissing.push(ob)
  }
  console.log(`Will backfill ${matched.length} OB lots`)
  console.log(`Still missing  ${stillMissing.length} OB lots\n`)

  console.log('Sample matches (first 10):')
  matched.slice(0, 10).forEach(m => {
    console.log(`  ${m.ob.lotNo.padEnd(14)} [${m.source.padEnd(9)}] ← ${m.originalLot.padEnd(10)}  LR ${m.lr.padEnd(10)}  ${m.ob.party?.slice(0, 22)}`)
  })
  const fromCurrent = matched.filter(m => m.source === 'current').length
  const fromLastYear = matched.filter(m => m.source === 'last-year').length
  console.log(`\nMatched ${fromCurrent} from current sheet, ${fromLastYear} from last-year sheet`)

  console.log('\nSample still-missing (first 5):')
  stillMissing.slice(0, 5).forEach(o => {
    console.log(`  ${o.lotNo.padEnd(14)}  ${o.party?.slice(0, 30)}  ${o.openingThan} than`)
  })

  if (!APPLY) return console.log('\n(dry run — re-run with --apply to write changes)')

  console.log('\nApplying updates…')
  let ok = 0, fail = 0
  for (const m of matched) {
    try {
      await prisma.lotOpeningBalance.update({ where: { id: m.ob.id }, data: { lrNo: m.lr } })
      ok++
    } catch (e) { fail++; console.error(`  FAIL ${m.ob.lotNo}: ${e.message}`) }
  }
  console.log(`Done: ${ok} updated, ${fail} failed`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
