import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/fold/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  const program = await (prisma as any).foldProgram.findUnique({
    where: { id },
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
  if (!program) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(program)
}

// PATCH /api/fold/[id] — update status or notes
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  const { status, notes } = await req.json()

  const program = await (prisma as any).foldProgram.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(notes !== undefined && { notes }),
    },
  })
  return NextResponse.json(program)
}

// DELETE /api/fold/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  await (prisma as any).foldProgram.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
