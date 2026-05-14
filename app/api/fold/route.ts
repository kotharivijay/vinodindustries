export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

// GET /api/fold — list all fold programs
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const programs = await (prisma as any).foldProgram.findMany({
    orderBy: { date: 'desc' },
    include: {
      batches: {
        include: {
          shade: true,
          lots: {
            include: { party: true, quality: true },
          },
        },
        orderBy: { batchNo: 'asc' },
      },
    },
  })
  return NextResponse.json(programs)
}

// POST /api/fold — create new fold program
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { foldNo, date, notes, batches } = body

  if (!foldNo?.trim()) return NextResponse.json({ error: 'Fold No required' }, { status: 400 })
  if (!date) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!batches?.length) return NextResponse.json({ error: 'At least one batch required' }, { status: 400 })

  try {
    const program = await (prisma as any).foldProgram.create({
      data: {
        foldNo: foldNo.trim(),
        date: new Date(date),
        notes: notes?.trim() || undefined,
        status: 'draft',
        batches: {
          create: batches.map((batch: any, idx: number) => ({
            batchNo: batch.batchNo ?? idx + 1,
            shadeId: batch.shadeId || undefined,
            shadeName: batch.shadeName?.trim() || undefined,
            shadeDescription: batch.shadeDescription?.trim() || undefined,
            lots: {
              create: (batch.lots ?? []).map((lot: any) => ({
                lotNo: normalizeLotNo(lot.lotNo) ?? '',
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
