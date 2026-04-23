import { prisma } from '@/lib/prisma'

export const PETPOOJA_ATTN_BASE = 'https://attendanceinfo.petpooja.com'
export const PETPOOJA_PAYROLL_BASE = 'https://payroll.petpooja.com/api'

export interface PetpoojaAuth {
  token: string
  userId: number
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
    token: row.token, userId: row.userId, hoId: row.hoId, orgId: row.orgId,
    orgName: row.orgName, uniqueCode: row.uniqueCode, expiresAt: row.expiresAt,
  }
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

export function attnHeaders(auth: PetpoojaAuth): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${auth.token}`,
    'x-access-token': auth.token,
  }
}
