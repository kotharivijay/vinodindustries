import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const include = {
  items: {
    include: { chemical: { select: { id: true, name: true, unit: true } } },
    orderBy: { id: 'asc' as const },
  },
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const processes = await (prisma as any).dyeingProcess.findMany({
    orderBy: { name: 'asc' },
    include,
  })
  return NextResponse.json(processes)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, description, items } = await req.json() as {
    name: string
    description?: string
    items: { chemicalId: number; quantity: number }[]
  }
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  try {
    const process = await (prisma as any).dyeingProcess.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        items: {
          create: (items ?? [])
            .filter(i => i.chemicalId && i.quantity > 0)
            .map(i => ({ chemicalId: i.chemicalId, quantity: i.quantity })),
        },
      },
      include,
    })
    return NextResponse.json(process)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Process name already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
