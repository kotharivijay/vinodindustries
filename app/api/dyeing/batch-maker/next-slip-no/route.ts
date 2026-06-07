export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { peekNextSeries } from '@/lib/inv/series'

/**
 * Peek the next BM-N serial without incrementing — for UI display only.
 * The real allocation happens inside the POST /api/dyeing/batch-maker
 * transaction, so the value shown here can race if two batch makers save
 * concurrently. The serial that lands in the DB is always gap-free.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { no, fy } = await peekNextSeries('batch-maker')
  return NextResponse.json({ next: `BM-${no}`, no, fy })
}
