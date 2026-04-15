export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Seed Jet 1-9 if none exist
  const count = await db.dyeingMachine.count()
  if (count === 0) {
    await db.dyeingMachine.createMany({
      data: Array.from({ length: 9 }, (_, i) => ({
        number: i + 1,
        name: `Jet ${i + 1}`,
      })),
    })
  }

  const machines = await db.dyeingMachine.findMany({ orderBy: { number: 'asc' } })
  return NextResponse.json(machines)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { number, name } = await req.json()
  if (!number || !name?.trim()) return NextResponse.json({ error: 'Number and name required' }, { status: 400 })

  try {
    const machine = await db.dyeingMachine.create({
      data: { number: parseInt(number), name: name.trim() },
    })
    return NextResponse.json(machine)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Machine number already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, isActive } = await req.json()
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  const machine = await db.dyeingMachine.update({
    where: { id: parseInt(id) },
    data: { isActive },
  })
  return NextResponse.json(machine)
}
