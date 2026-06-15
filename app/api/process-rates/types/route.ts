export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/process-rates/types — active process types in display order. Drives
// the "add rate" line picker; each carries rateMode so the form knows whether
// to show one flat rate or three colour-category rates.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const types = await (prisma as any).processType.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  return NextResponse.json(types)
}

// POST /api/process-rates/types — add a new process type (process type "d":
// extend at runtime, no code change). rateMode must be FLAT or BY_COLOR_CATEGORY.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, name, rateMode, sortOrder } = await req.json() as {
    code?: string; name?: string; rateMode?: string; sortOrder?: number
  }
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (rateMode !== 'FLAT' && rateMode !== 'BY_COLOR_CATEGORY') {
    return NextResponse.json({ error: 'rateMode must be FLAT or BY_COLOR_CATEGORY' }, { status: 400 })
  }
  // Derive a stable code from the name when none supplied.
  const finalCode = (code?.trim() || name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')).replace(/^_+|_+$/g, '')

  try {
    const created = await (prisma as any).processType.create({
      data: { code: finalCode, name: name.trim(), rateMode, sortOrder: sortOrder ?? 100 },
    })
    return NextResponse.json(created)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'A process type with that code already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
