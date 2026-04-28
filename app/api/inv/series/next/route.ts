export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { peekNextSeries } from '@/lib/inv/series'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const seriesType = req.nextUrl.searchParams.get('type') || 'inward'
  const next = await peekNextSeries(seriesType)
  return NextResponse.json(next)
}
