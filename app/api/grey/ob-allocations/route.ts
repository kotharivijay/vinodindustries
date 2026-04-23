export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const VALID_STAGES = ['dyed', 'finished', 'packed'] as const

// GET ?balanceId=X or ?lotNo=X — list allocations for one OB
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const balanceIdStr = url.searchParams.get('balanceId')
  const lotNo = url.searchParams.get('lotNo')
  const db = prisma as any

  try {
    if (balanceIdStr) {
      const allocations = await db.lotOpeningBalanceAllocation.findMany({
        where: { balanceId: parseInt(balanceIdStr) },
        orderBy: { id: 'asc' },
      })
      return NextResponse.json(allocations)
    }
    if (lotNo) {
      const balance = await db.lotOpeningBalance.findFirst({
        where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
        include: { allocations: { orderBy: { id: 'asc' } } },
      })
      return NextResponse.json(balance || null)
    }
    // List all balances with their allocations
    const all = await db.lotOpeningBalance.findMany({
      where: { allocations: { some: {} } },
      include: { allocations: { orderBy: { id: 'asc' } } },
      orderBy: { lotNo: 'asc' },
    })
    return NextResponse.json(all)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

// PUT — replace all allocations for one OB lot
// Body: { balanceId, allocations: [{ stage, than, notes? }] }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { balanceId, allocations } = body
  if (!balanceId || !Array.isArray(allocations)) {
    return NextResponse.json({ error: 'balanceId and allocations[] required' }, { status: 400 })
  }

  const db = prisma as any

  // Load balance for validation
  const balance = await db.lotOpeningBalance.findUnique({ where: { id: parseInt(balanceId) } })
  if (!balance) return NextResponse.json({ error: 'OB lot not found' }, { status: 404 })

  // Validate stages + than values
  let total = 0
  for (const a of allocations) {
    if (!VALID_STAGES.includes(a.stage)) {
      return NextResponse.json({ error: `Invalid stage: ${a.stage}` }, { status: 400 })
    }
    const n = parseInt(a.than)
    if (!n || n <= 0) {
      return NextResponse.json({ error: 'Than must be positive integer' }, { status: 400 })
    }
    total += n
  }
  if (total > balance.openingThan) {
    return NextResponse.json({
      error: `Total allocated (${total}) exceeds opening balance (${balance.openingThan})`,
    }, { status: 400 })
  }

  // Replace allocations
  await db.lotOpeningBalanceAllocation.deleteMany({ where: { balanceId: balance.id } })
  if (allocations.length > 0) {
    await db.lotOpeningBalanceAllocation.createMany({
      data: allocations.map((a: any) => ({
        balanceId: balance.id,
        stage: a.stage,
        than: parseInt(a.than),
        notes: a.notes || null,
      })),
    })
  }

  // Return refreshed
  const refreshed = await db.lotOpeningBalance.findUnique({
    where: { id: balance.id },
    include: { allocations: { orderBy: { id: 'asc' } } },
  })
  return NextResponse.json(refreshed)
}
