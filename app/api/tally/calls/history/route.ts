import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const party = req.nextUrl.searchParams.get('party') || ''
  if (!party) return NextResponse.json({ history: [] })

  const db = viPrisma as any
  const logs = await db.callLog.findMany({
    where: { partyName: { equals: party, mode: 'insensitive' } },
    orderBy: { callDate: 'desc' },
    take: 20,
  })

  return NextResponse.json({
    history: logs.map((l: any) => ({
      callDate: l.callDate,
      note: l.note,
      promiseDate: l.promiseDate,
      promiseAmt: l.promiseAmt,
      nextFollowUp: l.nextFollowUp,
      calledBy: l.calledBy,
    })),
  })
}
