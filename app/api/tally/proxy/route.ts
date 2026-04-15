export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { queryTally } from '@/lib/tally'

// POST — proxy XML request to Tally, return raw XML
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { xml } = await req.json()
  if (!xml) return NextResponse.json({ error: 'XML required' }, { status: 400 })

  try {
    const response = await queryTally(xml)
    return new NextResponse(response, {
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Tally connection failed' }, { status: 502 })
  }
}
