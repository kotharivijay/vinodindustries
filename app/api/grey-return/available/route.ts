export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { greyReturnAvailability } from '@/lib/grey-return-available'

// GET /api/grey-return/available?partyId=N
// Thin wrapper — the maths lives in lib/grey-return-available.ts so the create
// route can re-validate against exactly the same numbers without an HTTP hop.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyId = Number(req.nextUrl.searchParams.get('partyId'))
  if (!Number.isFinite(partyId)) return NextResponse.json({ error: 'partyId required' }, { status: 400 })

  const avail = await greyReturnAvailability(partyId)
  if (!avail) return NextResponse.json({ error: 'Party not found' }, { status: 404 })
  return NextResponse.json(avail)
}
