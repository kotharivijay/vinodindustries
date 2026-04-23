import { prisma } from '@/lib/prisma'

export const PETPOOJA_ATTN_BASE = 'https://attendanceinfo.petpooja.com'
export const PETPOOJA_PAYROLL_BASE = 'https://payroll.petpooja.com/api'

export interface PetpoojaAuth {
  token: string
  userId: number
  username: string | null
  hoId: number
  orgId: number
  orgName: string | null
  uniqueCode: string | null
  expiresAt: Date
}

/**
 * Get the latest stored Petpooja token. Throws if none exists or expired.
 */
export async function getPetpoojaAuth(): Promise<PetpoojaAuth> {
  const db = prisma as any
  const row = await db.petpoojaToken.findFirst({ orderBy: { id: 'desc' } })
  if (!row) throw new Error('No Petpooja token saved. Capture one from /attendance/token')
  if (new Date(row.expiresAt) <= new Date()) {
    throw new Error(`Petpooja token expired on ${row.expiresAt.toISOString()}. Re-capture from payroll.petpooja.com`)
  }
  return {
    token: row.token, userId: row.userId, username: row.username ?? null,
    hoId: row.hoId, orgId: row.orgId,
    orgName: row.orgName, uniqueCode: row.uniqueCode, expiresAt: row.expiresAt,
  }
}

export interface DailyPunch { time: string; kind: 'IN' | 'OUT' }

/**
 * Pulls every employee's full punch list for a single day from
 * payroll.petpooja.com/reports/daily_punch. Cheaper than the per-employee
 * endpoint (one HTTP call instead of N) and exposes a `day_<M>_<D>` field
 * per employee whose value is a comma-separated list of punch times.
 *
 * Returns Map keyed by `code` (the same code attendance_master uses) →
 * alternating IN/OUT punches in chronological order.
 */
export async function fetchDailyPunches(auth: PetpoojaAuth, date: string): Promise<{
  byCode: Map<string, DailyPunch[]>
  problems: Set<string> // codes where punch count is odd
}> {
  const d = new Date(date + 'T00:00:00Z')
  const month = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const dayKey = `day_${month}_${day}`
  const errKey = `err_${dayKey}`

  const res = await fetch(`${PETPOOJA_PAYROLL_BASE}/reports/daily_punch`, {
    method: 'POST',
    headers: payrollHeaders(auth),
    body: JSON.stringify({ filter_start_date: date, filter_end_date: date, filter_branch: null }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`daily_punch ${res.status}: ${text.slice(0, 300)}`)
  const payload = JSON.parse(text)
  const rows: any[] = Array.isArray(payload?.data) ? payload.data : []

  const byCode = new Map<string, DailyPunch[]>()
  const problems = new Set<string>()
  for (const r of rows) {
    const code = String(r.code ?? '')
    if (!code) continue
    const raw: string | null = r[dayKey] ?? null
    if (!raw) continue
    const times = String(raw).split(',').map(t => t.trim()).filter(Boolean)
    byCode.set(code, times.map((time, i) => ({ time, kind: i % 2 === 0 ? 'IN' : 'OUT' })))
    if (r[errKey] === 'Problem') problems.add(code)
  }
  return { byCode, problems }
}

/**
 * Decode a Petpooja JWT payload (HS256). Does not verify signature.
 * Returns iat/exp in unix seconds plus any other top-level claims.
 */
export function decodePetpoojaJwt(token: string): { iat?: number; exp?: number; [k: string]: any } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Not a JWT')
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const decoded = Buffer.from(payload, 'base64').toString('utf8')
  return JSON.parse(decoded)
}

/**
 * payroll.petpooja.com/api/* uses Authorization: Bearer <token>
 */
export function payrollHeaders(auth: PetpoojaAuth): Record<string, string> {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${auth.token}`,
  }
}

/**
 * attendanceinfo.petpooja.com/* uses a plain `token: <value>` header
 * (NOT Bearer). Confirmed from the live JS bundle.
 */
export function attnHeaders(auth: PetpoojaAuth): Record<string, string> {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'token': auth.token,
  }
}
