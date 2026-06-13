export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

async function resolveIds(params: Promise<{ id: string; additionId: string }>) {
  const { id, additionId } = await params
  return { entryId: parseInt(id), addId: parseInt(additionId) }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; additionId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId, addId } = await resolveIds(params)
  if (isNaN(entryId) || isNaN(addId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const addition = await db.dyeingAddition.findFirst({
    where: { id: addId, entryId },
    include: { chemicals: { include: { chemical: true } }, machine: true, operator: true },
  })
  if (!addition) return NextResponse.json({ error: 'Round not found' }, { status: 404 })
  return NextResponse.json(addition)
}

// Replace the round's chemicals + optional metadata (reason, defectType,
// machineId, operatorId, time). Chemicals are replaced wholesale — clients
// send the full final list. Items get deleted + recreated inside a single
// transaction so partial failures can't leave half a round behind.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; additionId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId, addId } = await resolveIds(params)
  if (isNaN(entryId) || isNaN(addId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const existing = await db.dyeingAddition.findFirst({ where: { id: addId, entryId } })
  if (!existing) return NextResponse.json({ error: 'Round not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const meta: any = {}
  if ('reason' in body) meta.reason = body.reason || null
  if ('defectType' in body) meta.defectType = body.defectType || null
  if ('machineId' in body) meta.machineId = body.machineId ? parseInt(body.machineId) : null
  if ('operatorId' in body) meta.operatorId = body.operatorId ? parseInt(body.operatorId) : null
  if ('time' in body) meta.time = body.time || null

  let chemReplacement: any[] | null = null
  if (Array.isArray(body.chemicals)) {
    chemReplacement = body.chemicals.map((c: any) => ({
      chemicalId: c.chemicalId ?? null,
      name: String(c.name ?? '').trim(),
      quantity: parseFloat(c.quantity) || 0,
      unit: c.unit || 'kg',
      rate: c.rate != null && c.rate !== '' ? parseFloat(c.rate) : null,
      cost: c.cost != null && c.cost !== '' ? parseFloat(c.cost) : null,
    })).filter((c: any) => c.name)
  }

  const updated = await db.$transaction(async (tx: any) => {
    if (Object.keys(meta).length > 0) {
      await tx.dyeingAddition.update({ where: { id: addId }, data: meta })
    }
    if (chemReplacement !== null) {
      await tx.dyeingAdditionItem.deleteMany({ where: { additionId: addId } })
      if (chemReplacement.length > 0) {
        await tx.dyeingAdditionItem.createMany({
          data: chemReplacement.map(c => ({ ...c, additionId: addId })),
        })
      }
    }
    return tx.dyeingAddition.findUnique({
      where: { id: addId },
      include: { chemicals: { include: { chemical: true } }, machine: true, operator: true },
    })
  })

  return NextResponse.json(updated)
}

// Removing the round cascades to its items (FK onDelete: Cascade in schema)
// and decrements the parent entry's totalRounds so the slip's printed round
// count stays consistent. We deliberately do NOT change DyeingEntry.status —
// if the slip was marked 'patchy' from a re-dye that's now being removed,
// the operator should re-evaluate that explicitly.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; additionId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { entryId, addId } = await resolveIds(params)
  if (isNaN(entryId) || isNaN(addId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const existing = await db.dyeingAddition.findFirst({ where: { id: addId, entryId } })
  if (!existing) return NextResponse.json({ error: 'Round not found' }, { status: 404 })

  await db.$transaction(async (tx: any) => {
    await tx.dyeingAddition.delete({ where: { id: addId } })
    await tx.dyeingEntry.update({
      where: { id: entryId },
      data: { totalRounds: { decrement: 1 } },
    })
  })

  return NextResponse.json({ ok: true })
}
