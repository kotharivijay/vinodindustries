export const dynamic = 'force-dynamic'
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

// Default processes to seed if none exist
const DEFAULT_PROCESSES: { name: string; chemicals: string[]; quantities: number[] }[] = [
  { name: 'Scouring', chemicals: ['Caustic Soda Flakes', 'Soda Ash', 'Hydrogen Peroxide', 'XNI'], quantities: [2, 3, 1.5, 0.5] },
  { name: 'Anti Fungus', chemicals: ['AFR'], quantities: [0.3] },
  { name: 'Levelling', chemicals: ['Level PEL'], quantities: [0.5] },
  { name: 'Washing', chemicals: ['Soaping Agent'], quantities: [1] },
]

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let processes = await (prisma as any).dyeingProcess.findMany({
    orderBy: { name: 'asc' },
    include,
  })

  // Auto-seed default processes if none exist
  if (processes.length === 0) {
    for (const dp of DEFAULT_PROCESSES) {
      try {
        const chemIds: { chemicalId: number; quantity: number }[] = []
        for (let i = 0; i < dp.chemicals.length; i++) {
          const chem = await (prisma as any).chemical.findFirst({ where: { name: { contains: dp.chemicals[i], mode: 'insensitive' } } })
          if (chem) chemIds.push({ chemicalId: chem.id, quantity: dp.quantities[i] })
        }
        await (prisma as any).dyeingProcess.create({
          data: {
            name: dp.name,
            items: { create: chemIds },
          },
        })
      } catch (_) { /* skip if already exists or chemical not found */ }
    }
    processes = await (prisma as any).dyeingProcess.findMany({
      orderBy: { name: 'asc' },
      include,
    })
  }

  return NextResponse.json(processes)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, description, threshold, items } = await req.json() as {
    name: string
    description?: string
    threshold?: number
    items: { chemicalId: number; quantity: number; quantityHigh?: number | null }[]
  }
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  try {
    const process = await (prisma as any).dyeingProcess.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        threshold: threshold ?? 220,
        items: {
          create: (items ?? [])
            .filter(i => i.chemicalId && i.quantity > 0)
            .map(i => ({ chemicalId: i.chemicalId, quantity: i.quantity, quantityHigh: i.quantityHigh ?? null })),
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
