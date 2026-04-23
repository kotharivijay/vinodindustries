import { prisma } from '@/lib/prisma'

export const PETPOOJA_ATTN_BASE = 'https://attendanceinfo.petpooja.com'
export const PETPOOJA_PAYROLL_BASE = 'https://payroll.petpooja.com/api'

// Static AWS-level app token hardcoded in Petpooja's web bundle.
// Sent in the body of attendanceinfo.petpooja.com requests as `access_token`.
export const PETPOOJA_APP_ACCESS_TOKEN = '605ab775311eeee0ffa2c1d999e2968474f5381d'

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

/**
 * Body fields the Petpooja web bundle's axios interceptor injects on every
 * attendanceinfo.petpooja.com call. Endpoints add their own fields (e.g. emp_id).
 */
export function attnAppBody(auth: PetpoojaAuth): Record<string, any> {
  return {
    access_token: PETPOOJA_APP_ACCESS_TOKEN,
    username: auth.username || 'OFFICE',
    user_id: auth.userId,
    device_type: 'web',
  }
}

/**
 * Fetch every punch row for a single employee. Petpooja returns punches for
 * the current pay period (no date filter on the wire) — caller filters by date.
 */
export async function fetchEmployeePunches(auth: PetpoojaAuth, empId: number): Promise<any[]> {
  const res = await fetch(
    `${PETPOOJA_ATTN_BASE}/attendance_regularization/employee_punch_data`,
    {
      method: 'POST',
      headers: attnHeaders(auth),
      body: JSON.stringify({ emp_id: empId, ...attnAppBody(auth) }),
    },
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`Petpooja punch ${res.status}: ${text.slice(0, 300)}`)
  let payload: any
  try { payload = JSON.parse(text) } catch { throw new Error(`Punch endpoint returned non-JSON: ${text.slice(0, 200)}`) }
  return Array.isArray(payload?.data) ? payload.data : []
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
