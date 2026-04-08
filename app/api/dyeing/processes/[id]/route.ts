import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: idStr } = await params
  const id = parseInt(idStr)
  const { name, description, threshold, items } = await req.json() as {
    name: string
    description?: string
    threshold?: number
    items: { chemicalId: number; quantity: number; quantityHigh?: number | null }[]
  }
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  try {
    const process = await (prisma as any).$transaction(async (tx: any) => {
      await tx.dyeingProcess.update({
        where: { id },
        data: { name: name.trim(), description: description?.trim() || null, threshold: threshold ?? 220 },
      })
      await tx.dyeingProcessItem.deleteMany({ where: { processId: id } })
      if (items?.length > 0) {
        await tx.dyeingProcessItem.createMany({
          data: items
            .filter(i => i.chemicalId && i.quantity > 0)
            .map(i => ({ processId: id, chemicalId: i.chemicalId, quantity: i.quantity, quantityHigh: i.quantityHigh ?? null })),
        })
      }
      return tx.dyeingProcess.findUnique({
        where: { id },
        include: {
          items: {
            include: { chemical: { select: { id: true, name: true, unit: true } } },
            orderBy: { id: 'asc' },
          },
        },
      })
    })
    return NextResponse.json(process)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Process name already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return PUT(req, { params })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: idStr } = await params
  const id = parseInt(idStr)
  await (prisma as any).dyeingProcess.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
