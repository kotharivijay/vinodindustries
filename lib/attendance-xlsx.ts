// Parser for Petpooja's "Daily Punch Report" xlsx export.
//
// Verified layout (Sep 2026 export): one sheet, header on the first row —
//   Employee ID | Employee Name | Department | Designation | "01-09-2026 \n Tuesday" | …
// and one newline-separated list of 12-hour punch times per (employee, date)
// cell ("09:15 AM\n02:34 PM"). The sniffing below also tolerates a title row
// above the header, YYYY-MM-DD or bare day-number date headers, comma
// separators and 24-hour times, so a slightly different export still loads.
//
// Only `xlsx` is imported (no '@/…' aliases) so the module runs standalone
// from a Node script for verification.

import * as XLSX from 'xlsx'

export interface ParsedDay {
  date: string            // YYYY-MM-DD
  code: string
  name: string
  department: string | null
  designation: string | null
  times: string[]         // "HH:mm" 24h, ascending
  problem: boolean        // odd punch count
}

export interface ParseResult {
  days: ParsedDay[]
  fromDate: string
  toDate: string
  employees: number
  skipped: { row: number; reason: string }[]
  problems: Record<string, number>   // date → rows with odd punch count
  headerRow: number
  dateColumns: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad2 = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`
const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

type DateHeader = { col: number; date: string }

/** First line of a header cell ("01-09-2026 \n Tuesday" → "01-09-2026"). */
function headerText(v: unknown): string {
  return String(v ?? '').split(/\r?\n/)[0].trim()
}

function fullDateFromHeader(text: string): string | null {
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text)          // DD-MM-YYYY
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]))
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text)              // YYYY-MM-DD
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s,]+(\d{4})$/i.exec(text)   // 01-Sep-2026 / 1 Sep 2026
  if (m) { const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1; if (mo) return iso(Number(m[3]), mo, Number(m[1])) }
  return null
}

/** Month/year hints from title rows, sheet name and file name, for headers that
 *  carry only a day number. */
function contextMonthYear(hints: string[], today: Date): { month: number | null; year: number | null } {
  let month: number | null = null, year: number | null = null
  for (const h of hints) {
    const s = h.toLowerCase()
    const mName = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/.exec(s)
    if (mName && month == null) month = MONTHS.indexOf(mName[1]) + 1
    const y = /(20\d{2})/.exec(s)
    if (y && year == null) year = Number(y[1])
    const mNum = /(?:^|\D)(\d{1,2})[-/](20\d{2})(?:\D|$)/.exec(s)      // 09-2026 / 9/2026
    if (mNum && month == null) { month = Number(mNum[1]); year = year ?? Number(mNum[2]) }
    if (month != null && year != null) break
  }
  if (month != null && year == null) {
    year = today.getFullYear()
    const candidate = new Date(year, month - 1, 1)
    if (candidate.getTime() - today.getTime() > 60 * 86400e3) year -= 1
  }
  return { month, year }
}

function isDateLikeHeader(text: string): boolean {
  return fullDateFromHeader(text) != null || /^\d{1,2}$/.test(text) || /^\d{1,2}[-/](\d{1,2})$/.test(text)
    || /^\d{1,2}[-\s][a-z]{3}/i.test(text) || /^[a-z]{3}[-\s]\d{1,2}$/i.test(text)
}

const IGNORE_COL = /total|present|absent|hrs|hours|days|late|early|overtime|ot\b/i

/** Normalise one punch cell into ascending "HH:mm" times. Unparseable tokens
 *  are returned separately so the caller can report them. */
export function normalisePunchCell(v: unknown): { times: string[]; bad: string[] } {
  const bad: string[] = []
  const out = new Set<string>()
  if (typeof v === 'number') {
    // Excel time fraction (or a date-time serial — take the fractional part)
    const frac = v >= 1 ? v - Math.floor(v) : v
    if (frac >= 0 && frac < 1) out.add(fmtMin(Math.round(frac * 1440) % 1440))
    return { times: [...out].sort(), bad }
  }
  const raw = String(v ?? '')
  for (const tokRaw of raw.split(/[\n\r,;|]+/)) {
    const tok = tokRaw.trim()
    if (!tok || /^(-+|a|ab|absent|wo|h|na|n\/a|off)$/i.test(tok)) continue
    const t = parseTime(tok)
    if (t) out.add(t); else bad.push(tok)
  }
  return { times: [...out].sort(), bad }
}

function fmtMin(min: number) { return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}` }

function parseTime(tok: string): string | null {
  let m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap])\.?\s*m?\.?$/i.exec(tok)   // 09:15 AM / 9.15 pm / 09:15:00 PM
  if (m) {
    let h = Number(m[1]) % 12
    if (m[3].toLowerCase() === 'p') h += 12
    return fmtMin(h * 60 + Number(m[2]))
  }
  m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(tok)                           // 24h
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return fmtMin(Number(m[1]) * 60 + Number(m[2]))
  m = /^(\d{2})(\d{2})$/.exec(tok)                                             // 0915
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return fmtMin(Number(m[1]) * 60 + Number(m[2]))
  return null
}

export function parsePunchWorkbook(buf: Buffer | Uint8Array, opts: { fileName?: string; today?: Date } = {}): ParseResult {
  const today = opts.today ?? new Date()
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Workbook has no sheets')
  const ws = wb.Sheets[sheetName]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })

  // ── header row ──
  let headerRow = -1, best = 0
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map(norm)
    const hasCode = cells.some(c => /^(employee\s*(id|code)|emp\.?\s*(id|code)|code)$/.test(c))
    const hasName = cells.some(c => /name/.test(c))
    const dateCount = rows[r].filter(c => isDateLikeHeader(headerText(c))).length
    const score = (hasCode ? 2 : 0) + (hasName ? 1 : 0) + (dateCount >= 1 ? 1 : 0)
    if (hasCode && dateCount >= 1 && score > best) { best = score; headerRow = r }
  }
  if (headerRow < 0) throw new Error('Could not find the header row (need an "Employee ID" column and date columns)')
  const header = rows[headerRow]
  const hn = header.map(norm)
  const codeCol = hn.findIndex(c => /^(employee\s*(id|code)|emp\.?\s*(id|code)|code)$/.test(c))
  const nameCol = hn.findIndex(c => /name/.test(c))
  const deptCol = hn.findIndex(c => /^(dept\.?|department)$/.test(c))
  const desigCol = hn.findIndex(c => /^(designation|desig\.?)$/.test(c))

  // ── date columns ──
  const hints = [
    ...rows.slice(0, headerRow).flat().map(c => String(c ?? '')),
    sheetName, opts.fileName ?? '',
  ]
  const firstFull = header.map(c => fullDateFromHeader(headerText(c))).find(Boolean) ?? null
  if (firstFull) hints.push(firstFull)
  const ctx = contextMonthYear(hints, today)
  const dateCols: DateHeader[] = []
  let lastDay = 0, month = ctx.month, year = ctx.year
  for (let c = 0; c < header.length; c++) {
    if (c === codeCol || c === nameCol || c === deptCol || c === desigCol) continue
    const text = headerText(header[c])
    if (!text || IGNORE_COL.test(text)) continue
    const full = fullDateFromHeader(text)
    if (full) { dateCols.push({ col: c, date: full }); lastDay = Number(full.slice(8)); continue }
    let m = /^(\d{1,2})[-/](\d{1,2})$/.exec(text)                             // DD-MM
    if (m) {
      const d = Number(m[1]), mo = Number(m[2])
      if (year == null) throw new Error(`Header "${text}" has no year and none could be inferred`)
      dateCols.push({ col: c, date: iso(year, mo, d) }); lastDay = d; continue
    }
    m = /^(\d{1,2})[-\s]([a-z]{3})/i.exec(text) || /^([a-z]{3})[-\s](\d{1,2})$/i.exec(text)
    if (m) {
      const d = Number(/^\d/.test(m[1]) ? m[1] : m[2])
      const mo = MONTHS.indexOf((/^\d/.test(m[1]) ? m[2] : m[1]).toLowerCase()) + 1
      if (mo && year != null) { dateCols.push({ col: c, date: iso(year, mo, d) }); lastDay = d; continue }
    }
    m = /^(\d{1,2})$/.exec(text)                                              // bare day
    if (m) {
      const d = Number(m[1])
      if (month == null || year == null) throw new Error(`Header "${text}" is a bare day number and no month/year could be inferred`)
      if (d < lastDay) { month += 1; if (month > 12) { month = 1; year += 1 } }   // rollover
      dateCols.push({ col: c, date: iso(year, month, d) }); lastDay = d
    }
  }
  if (!dateCols.length) throw new Error('No date columns found in the header row')

  // ── data rows ──
  const days: ParsedDay[] = []
  const skipped: ParseResult['skipped'] = []
  const problems: Record<string, number> = {}
  const seen = new Map<string, number>()   // `${date}|${code}` → index in days
  const codes = new Set<string>()
  let emptyRun = 0
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]
    const code = String(row[codeCol] ?? '').trim()
    const name = String(row[nameCol] ?? '').trim()
    if (!code && !name && row.every(c => String(c ?? '').trim() === '')) { if (++emptyRun >= 5) break; continue }
    emptyRun = 0
    if (!code || /total|grand/i.test(code) || /^total/i.test(name)) { skipped.push({ row: r + 1, reason: code ? `summary row "${code}"` : 'blank employee id' }); continue }
    if (!name) { skipped.push({ row: r + 1, reason: `employee ${code} has no name` }); continue }
    codes.add(code)
    const department = deptCol >= 0 ? (String(row[deptCol] ?? '').trim() || null) : null
    const designation = desigCol >= 0 ? (String(row[desigCol] ?? '').trim() || null) : null
    for (const dc of dateCols) {
      const { times, bad } = normalisePunchCell(row[dc.col])
      for (const b of bad) skipped.push({ row: r + 1, reason: `unreadable time "${b}" for ${code} on ${dc.date}` })
      const day: ParsedDay = { date: dc.date, code, name, department, designation, times, problem: times.length % 2 === 1 }
      const key = `${dc.date}|${code}`
      const prev = seen.get(key)
      if (prev != null) {
        skipped.push({ row: r + 1, reason: `duplicate employee id ${code} (kept the row with more punches)` })
        if (times.length > days[prev].times.length) days[prev] = day
        continue
      }
      seen.set(key, days.length)
      days.push(day)
    }
  }
  for (const d of days) if (d.problem) problems[d.date] = (problems[d.date] ?? 0) + 1
  const dates = dateCols.map(d => d.date).sort()
  return {
    days, fromDate: dates[0], toDate: dates[dates.length - 1],
    employees: codes.size, skipped, problems, headerRow, dateColumns: dateCols.length,
  }
}
