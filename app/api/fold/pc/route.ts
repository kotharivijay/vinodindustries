import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET /api/fold/pc — list all PC fold programs
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const programs = await db.foldProgram.findMany({
    where: { isPcJob: true },
    orderBy: { date: 'desc' },
    include: {
      batches: {
        include: {
          shade: true,
          lots: {
            include: { party: true, quality: true },
          },
          dyeingEntries: { select: { id: true } },
        },
        orderBy: { batchNo: 'asc' },
      },
    },
  })
  return NextResponse.json(programs)
}

// POST /api/fold/pc — create new PC fold program
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { foldNo, date, notes, batches } = body

  if (!foldNo?.trim()) return NextResponse.json({ error: 'Fold No required' }, { status: 400 })
  if (!date) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!batches?.length) return NextResponse.json({ error: 'At least one batch required' }, { status: 400 })

  try {
    const program = await db.foldProgram.create({
      data: {
        foldNo: foldNo.trim(),
        date: new Date(date),
        notes: notes?.trim() || undefined,
        status: 'draft',
        isPcJob: true,
        batches: {
          create: batches.map((batch: any, idx: number) => ({
            batchNo: batch.batchNo ?? idx + 1,
            shadeId: batch.shadeId || undefined,
            shadeName: batch.shadeName?.trim() || undefined,
            shadeDescription: batch.shadeDescription?.trim() || undefined,
            marka: batch.marka?.trim() || undefined, // comma-separated for multi-marka
            lots: {
              create: (batch.lots ?? []).map((lot: any) => ({
                lotNo: lot.lotNo.trim(),
                partyId: lot.partyId || undefined,
                qualityId: lot.qualityId || undefined,
                than: parseInt(lot.than) || 0,
              })),
            },
          })),
        },
      },
      include: {
        batches: {
          include: {
            shade: true,
            lots: { include: { party: true, quality: true } },
          },
          orderBy: { batchNo: 'asc' },
        },
      },
    })
    return NextResponse.json(program)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Fold No already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/fold/pc?id=X&action=confirm — confirm a PC fold program
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  const action = req.nextUrl.searchParams.get('action')

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (action !== 'confirm') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  try {
    const updated = await db.foldProgram.update({
      where: { id: parseInt(id) },
      data: {
        confirmedAt: new Date(),
        status: 'confirmed',
      },
      include: {
        batches: {
          include: {
            shade: true,
            lots: { include: { party: true, quality: true } },
          },
          orderBy: { batchNo: 'asc' },
        },
      },
    })
    return NextResponse.json(updated)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/fold/pc?id=X — delete a PC fold program
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    await db.foldProgram.delete({ where: { id: parseInt(id) } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
