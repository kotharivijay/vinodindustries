// One-off: seed Quality.widthInch by parsing names. ALWAYS run without
// --apply first and review the table — Rs 25/than billing rules ride on this.
//
//   node scripts/backfill-quality-width.mjs           (review)
//   node scripts/backfill-quality-width.mjs --apply   (write nulls -> parsed)
//
// Only fills NULLs; never overwrites a width someone set by hand.
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
const m = readFileSync('.env.production.local', 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
const db = new PrismaClient({ datasources: { db: { url: m[1].replace(/\\n\s*$/, '').trim() } } })
const APPLY = process.argv.includes('--apply')

// mirror of lib/quality-width.ts (scripts can't import TS)
const INCH_RE = /(\d{2})\s*(?:"|″|''|”|’’)/
const CON_RE = /\d{2,3}\s*\*\s*\d{2,3}/
const CON_ALL_RE = /\d{2,3}\s*\*\s*\d{2,3}/g
const MIN_W = 30, MAX_W = 72
function parseWidthInch(name) {
  const raw = String(name ?? '').trim()
  if (!raw) return null
  const inch = INCH_RE.exec(raw)
  if (inch) { const w = parseInt(inch[1], 10); return w >= MIN_W && w <= MAX_W ? w : null }
  if (CON_RE.test(raw)) {
    const tail = /(\d{2})\s*$/.exec(raw.replace(CON_ALL_RE, ' ').trim())
    if (!tail) return null
    const w = parseInt(tail[1], 10)
    return w >= MIN_W && w <= MAX_W ? w : null
  }
  const tail = /(\d{2})\s*$/.exec(raw)
  if (tail) { const w = parseInt(tail[1], 10); return w >= MIN_W && w <= MAX_W ? w : null }
  return null
}

const qualities = await db.quality.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, widthInch: true } })
let fill = 0, skip = 0, manual = 0
console.log('id   | name                             | current | parsed | action')
console.log('-'.repeat(80))
for (const q of qualities) {
  const parsed = parseWidthInch(q.name)
  const action = q.widthInch != null ? 'keep (already set)' : parsed != null ? `SET ${parsed}` : 'leave null (review by hand)'
  if (q.widthInch != null) skip++
  else if (parsed != null) fill++
  else manual++
  console.log(`${String(q.id).padStart(4)} | ${q.name.padEnd(32)} | ${String(q.widthInch ?? '-').padStart(7)} | ${String(parsed ?? '-').padStart(6)} | ${action}`)
}
console.log('-'.repeat(80))
console.log(`${qualities.length} qualities: fill ${fill}, already set ${skip}, unparseable ${manual}`)

if (!APPLY) { console.log('\n(review mode — rerun with --apply to write)'); await db.$disconnect(); process.exit(0) }

let wrote = 0
for (const q of qualities) {
  if (q.widthInch != null) continue
  const parsed = parseWidthInch(q.name)
  if (parsed == null) continue
  await db.quality.update({ where: { id: q.id }, data: { widthInch: parsed } })
  wrote++
}
console.log(`\nWrote widthInch on ${wrote} qualities.`)
await db.$disconnect()
