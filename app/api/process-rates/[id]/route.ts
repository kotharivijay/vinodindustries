export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { lineInclude, dec, validateLines, lineData, VALIDITY_UNITS, type LineInput } from '@/lib/processRates'

// PUT /api/process-rates/[id] — edit a contract in place (fix data entry).
// Replaces validity/notes/effectiveFrom and the full set of rate lines without
// creating a new version. Use POST /api/process-rates for an actual rate change
// (which versions + supersedes). Status is left untouched here.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const body = await req.json() as {
    effectiveFrom?: string
    validityQty?: string | number | null
    validityUnit?: string | null
    notes?: string | null
    lines: LineInput[]
  }
  const validityUnit = body.validityUnit && (VALIDITY_UNITS as readonly string[]).includes(body.validityUnit)
    ? body.validityUnit : null

  try {
    const updated = await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.processRateContract.findUnique({ where: { id } })
      if (!existing) throw new Error('Contract not found')

      const err = await validateLines(tx, body.lines)
      if (err) throw new Error(err)

      await tx.processRateContract.update({
        where: { id },
        data: {
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : existing.effectiveFrom,
          validityQty: dec(body.validityQty),
          validityUnit,
          notes: body.notes?.trim() || null,
        },
      })
      await tx.processRateLine.deleteMany({ where: { contractId: id } })
      await tx.processRateLine.createMany({
        data: body.lines.map(l => ({ contractId: id, ...lineData(l) })),
      })
      return tx.processRateContract.findUnique({ where: { id }, include: lineInclude })
    })
    return NextResponse.json(updated)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }
}

// DELETE /api/process-rates/[id]
// Blocked when grey-inward lots reference the contract — those lots must keep
// their rate link. Lines cascade-delete with the contract.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const linked = await (prisma as any).greyEntry.count({ where: { processRateContractId: id } })
  if (linked > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${linked} lot${linked > 1 ? 's are' : ' is'} linked to this rate. Cancel it instead.` },
      { status: 409 },
    )
  }

  try {
    await (prisma as any).processRateContract.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.code === 'P2025') return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
