export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { peekNextSeries } from '@/lib/inv/series'

// Display-only peek. The real number is allocated inside the create
// transaction, so this can be stale if two people save at once — that's fine,
// the counter is the authority.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { no, fy } = await peekNextSeries('grey-return')
  return NextResponse.json({ next: `GR-${no}`, no, fy })
}
