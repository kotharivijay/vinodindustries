export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { seriesGapReport, getCurrentFy } from '@/lib/inv/series'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const type = req.nextUrl.searchParams.get('type') || 'inward'
  const fy = req.nextUrl.searchParams.get('fy') || getCurrentFy()
  const report = await seriesGapReport(type, fy)
  return NextResponse.json(report)
}
