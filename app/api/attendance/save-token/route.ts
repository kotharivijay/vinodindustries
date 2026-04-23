export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { decodePetpoojaJwt } from '@/lib/petpooja'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/**
 * POST /api/attendance/save-token
 * Body: { authUser: <parsed JSON from sessionStorage.authUser> }
 * OR:   { token, userId, hoId, orgId, orgName, uniqueCode, email }
 *
 * Auth: either a valid NextAuth session OR Bearer ATTENDANCE_CAPTURE_SECRET
 * (so a DevTools snippet can POST without cookies).
 */
function cors(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: CORS })
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const capSecret = process.env.ATTENDANCE_CAPTURE_SECRET
  const isSecret = capSecret && auth === `Bearer ${capSecret}`
  if (!isSecret) {
    const session = await getServerSession(authOptions)
    if (!session) return cors({ error: 'Unauthorized' }, 401)
  }

  let body: any = {}
  try { body = await req.json() } catch { return cors({ error: 'Invalid JSON' }, 400) }

  // Accept either the raw authUser wrapper OR flat fields
  const au = body.authUser?.data ?? body.data ?? body
  const token: string = body.authUser?.token ?? body.token ?? au.token
  if (!token) return cors({ error: 'Missing token' }, 400)

  let exp = 0
  try { exp = Number(decodePetpoojaJwt(token).exp) || 0 } catch {}
  if (!exp) return cors({ error: 'Could not decode JWT exp claim' }, 400)

  const data = {
    token,
    userId: Number(au.user_id ?? body.userId ?? 0) || 0,
    username: au.username || body.username || null,
    userEmail: au.email || body.email || null,
    hoId: Number(au.ho_id ?? body.hoId ?? 0) || 0,
    orgId: Number(au.organization_id ?? body.orgId ?? 0) || 0,
    orgName: au.organization_name || body.orgName || null,
    uniqueCode: au.unique_code || body.uniqueCode || null,
    expiresAt: new Date(exp * 1000),
    updatedAt: new Date(),
  }
  if (!data.userId || !data.hoId || !data.orgId) {
    return cors({ error: 'Missing userId / hoId / orgId in payload', received: data }, 400)
  }

  const db = prisma as any
  const saved = await db.petpoojaToken.create({ data })

  return NextResponse.json({
    ok: true,
    id: saved.id,
    orgName: saved.orgName,
    expiresAt: saved.expiresAt,
    daysLeft: Math.round((saved.expiresAt.getTime() - Date.now()) / 86400000),
  }, { headers: CORS })
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = prisma as any
  const row = await db.petpoojaToken.findFirst({ orderBy: { id: 'desc' } })
  if (!row) return NextResponse.json({ present: false })
  const now = Date.now()
  return NextResponse.json({
    present: true,
    orgName: row.orgName,
    userEmail: row.userEmail,
    expiresAt: row.expiresAt,
    daysLeft: Math.max(0, Math.round((new Date(row.expiresAt).getTime() - now) / 86400000)),
    expired: new Date(row.expiresAt).getTime() <= now,
  })
}
