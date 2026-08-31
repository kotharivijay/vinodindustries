export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// PATCH — tick or untick a MANUAL billing rule on challan lines.
// Body: { lineIds: number[], ruleId: number, on: boolean }
//
// Ticks are stored per line (not per clubbed row) so the stored state is
// independent of how the view groups; the view applies a tick to every line
// under the clubbed row it shows the checkbox on.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const challanId = parseInt(id)

  const body = await req.json()
  const ruleId = parseInt(String(body.ruleId))
  const on = !!body.on
  const lineIds: number[] = Array.isArray(body.lineIds)
    ? body.lineIds.map((x: any) => parseInt(String(x))).filter(Number.isFinite)
    : []
  if (!Number.isFinite(ruleId) || lineIds.length === 0) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'ruleId and lineIds required' }, { status: 400 })
  }

  const challan = await db.finishDeliveryChallan.findUnique({
    where: { id: challanId },
    select: { partyId: true, lines: { select: { id: true } } },
  })
  if (!challan) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const validLineIds = new Set(challan.lines.map((l: any) => l.id))
  const foreign = lineIds.filter(lid => !validLineIds.has(lid))
  if (foreign.length) {
    return NextResponse.json({ error: 'LINE_MISMATCH', message: 'One or more lines are not on this challan.' }, { status: 400 })
  }

  const rule = await db.processRateRule.findUnique({
    where: { id: ruleId },
    select: { trigger: true, active: true, contract: { select: { partyId: true } } },
  })
  if (!rule || !rule.active) return NextResponse.json({ error: 'RULE_NOT_FOUND' }, { status: 404 })
  if (rule.trigger !== 'manual') {
    return NextResponse.json({ error: 'NOT_MANUAL', message: 'Only manual rules can be ticked — auto/LR rules are computed.' }, { status: 400 })
  }
  if (rule.contract.partyId !== challan.partyId) {
    return NextResponse.json({ error: 'PARTY_MISMATCH', message: "That rule belongs to a different party's contract." }, { status: 400 })
  }

  if (on) {
    await db.challanLineRuleTick.createMany({
      data: lineIds.map(lid => ({ lineId: lid, ruleId })),
      skipDuplicates: true,
    })
  } else {
    await db.challanLineRuleTick.deleteMany({ where: { ruleId, lineId: { in: lineIds } } })
  }
  return NextResponse.json({ ok: true })
}
