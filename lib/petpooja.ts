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

/**
 * Per-tenant AWS access token baked into the Petpooja SPA bundle.
 * The /division/* and /get_employees endpoints on attendanceinfo
 * require BOTH the Bearer JWT (header) AND this token (body).
 *
 * Single-firm setup right now (KSI/VI). When VI gets its own Petpooja
 * tenant, lift this to per-firm config.
 */
export const PETPOOJA_AWS_ACCESS_TOKEN = '605ab775311eeee0ffa2c1d999e2968474f5381d'

function attnInfoBody(auth: PetpoojaAuth, method: string, extra: Record<string, any> = {}) {
  return {
    is_web_req: 1,
    method,
    access_token: PETPOOJA_AWS_ACCESS_TOKEN,
    username: auth.username || 'OFFICE',
    user_id: auth.userId,
    device_type: 'web',
    ...extra,
  }
}

function attnInfoHeaders(auth: PetpoojaAuth): Record<string, string> {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${auth.token}`,
  }
}

export interface PetpoojaDepartment {
  id: number
  name: string
  employee_count: number
  active?: number
  left?: number
  inactive?: number
  terminated?: number
}

/**
 * Pull the full department master from attendanceinfo. Unlike
 * attendance_master, this returns ALL departments regardless of branch
 * or roster status.
 */
export async function fetchAllDepartments(auth: PetpoojaAuth): Promise<PetpoojaDepartment[]> {
  const res = await fetch('https://attendanceinfo.petpooja.com/division/get_department', {
    method: 'POST',
    headers: attnInfoHeaders(auth),
    body: JSON.stringify(attnInfoBody(auth, 'department_list')),
  })
  if (!res.ok) throw new Error(`get_department ${res.status}`)
  const d = await res.json()
  if (d.status !== 1 || !Array.isArray(d.data)) throw new Error(d.message || 'get_department: bad response')
  return d.data.map((x: any) => {
    let counts: any = {}
    try { counts = JSON.parse(x.employee_status_counts || '{}') } catch {}
    return {
      id: Number(x.id),
      name: String(x.name || '').trim(),
      employee_count: Number(x.employee_count) || 0,
      active: Number(counts.Active) || 0,
      left: Number(counts.Left) || 0,
      inactive: Number(counts.Inactive) || 0,
      terminated: Number(counts.Terminated) || 0,
    }
  })
}

export interface PetpoojaFullEmployee {
  petpoojaEmpId: number
  code: string | null
  name: string
  department: string | null
  designation: string | null
  departmentId: number | null
  designationId: number | null
  mobileNumber: string | null
  status: number | null
  masterBranchId: number | null
}

/**
 * Pull the full employee master (every active + left + inactive) from
 * attendanceinfo. This replaces attendance_master for "give me all
 * employees" use-cases — attendance_master is roster/branch-filtered.
 */
export async function fetchAllEmployees(auth: PetpoojaAuth): Promise<PetpoojaFullEmployee[]> {
  const res = await fetch('https://attendanceinfo.petpooja.com/get_employees', {
    method: 'POST',
    headers: attnInfoHeaders(auth),
    body: JSON.stringify(attnInfoBody(auth, 'employee_list_tmp', { active_tag_only: false })),
  })
  if (!res.ok) throw new Error(`get_employees ${res.status}`)
  const d = await res.json()
  if (d.status !== 1 || !Array.isArray(d.data)) throw new Error(d.message || 'get_employees: bad response')
  return d.data.map((e: any) => ({
    petpoojaEmpId: Number(e.id),
    code: e.code != null ? String(e.code) : null,
    name: String(e.name || '').trim(),
    department: e.department ? String(e.department).trim() : null,
    designation: e.designation ? String(e.designation).trim() : null,
    departmentId: e.department_id != null ? Number(e.department_id) : null,
    designationId: e.designation_id != null ? Number(e.designation_id) : null,
    mobileNumber: e.mobile_number ? String(e.mobile_number).trim() : null,
    status: e.status != null ? Number(e.status) : null,
    masterBranchId: e.master_branch_id != null ? Number(e.master_branch_id) : null,
  })).filter((e: PetpoojaFullEmployee) => Number.isFinite(e.petpoojaEmpId) && e.petpoojaEmpId > 0)
}
