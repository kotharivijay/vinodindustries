import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { no } = await params
  const challanNo = parseInt(no)
  if (isNaN(challanNo)) return NextResponse.json({ error: 'Invalid challan' }, { status: 400 })

  const db = prisma as any
  try {
    const entries = await db.despatchEntry.findMany({
      where: { challanNo },
      include: { party: true, quality: true, transport: true, changeLogs: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(entries)
  } catch {
    // Fallback without changeLogs if table doesn't exist
    const entries = await prisma.despatchEntry.findMany({
      where: { challanNo },
      include: { party: true, quality: true, transport: true },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(entries.map(e => ({ ...e, changeLogs: [] })))
  }
}
