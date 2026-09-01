export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// POST — copy selected rules from contract [id] to other contract versions.
// Body: { ruleIds: number[], targetContractIds: number[] }
//
// Rules APPEND to the target (existing rules are kept). Per target:
//   - a rule scoped to a process type the target has no rate line for is
//     skipped (it could never fire there);
//   - an identical rule already present (same trigger/conditions/amount/label)
//     is skipped, so copying twice doesn't double-charge.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const sourceId = parseInt(id)

  const body = await req.json()
  const ruleIds: number[] = Array.isArray(body.ruleIds) ? body.ruleIds.map((x: any) => parseInt(String(x))).filter(Number.isFinite) : []
  const targetIds: number[] = Array.isArray(body.targetContractIds) ? body.targetContractIds.map((x: any) => parseInt(String(x))).filter(Number.isFinite) : []
  if (!ruleIds.length || !targetIds.length) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'ruleIds and targetContractIds required' }, { status: 400 })
  }
  if (targetIds.includes(sourceId)) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'Target cannot be the source version.' }, { status: 400 })
  }

  const source = await db.processRateContract.findUnique({ where: { id: sourceId }, select: { id: true, partyId: true } })
  if (!source) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const rules = await db.processRateRule.findMany({ where: { id: { in: ruleIds }, contractId: sourceId } })
  if (rules.length !== ruleIds.length) {
    return NextResponse.json({ error: 'RULE_MISMATCH', message: 'One or more rules do not belong to the source version.' }, { status: 400 })
  }

  const targets = await db.processRateContract.findMany({
    where: { id: { in: targetIds } },
    include: { lines: { select: { processTypeId: true } }, rules: true },
  })
  if (targets.length !== targetIds.length) {
    return NextResponse.json({ error: 'TARGET_NOT_FOUND', message: 'One or more target versions do not exist.' }, { status: 404 })
  }
  // Same party only — rules travel between versions, not between parties.
  const foreign = targets.filter((t: any) => t.partyId !== source.partyId)
  if (foreign.length) {
    return NextResponse.json({ error: 'PARTY_MISMATCH', message: "Targets must be the same party's versions." }, { status: 400 })
  }

  const sameRule = (a: any, b: any) =>
    a.trigger === b.trigger &&
    (a.processTypeId ?? null) === (b.processTypeId ?? null) &&
    (a.minThan ?? null) === (b.minThan ?? null) &&
    (a.maxThan ?? null) === (b.maxThan ?? null) &&
    (a.widthInch ?? null) === (b.widthInch ?? null) &&
    (a.machineNumber ?? null) === (b.machineNumber ?? null) &&
    String(a.amountPerThan) === String(b.amountPerThan) &&
    a.label.trim().toLowerCase() === b.label.trim().toLowerCase()

  const results: Array<{ contractId: number; version: number; copied: number; skippedNoLine: number; skippedDuplicate: number }> = []
  await db.$transaction(async (tx: any) => {
    for (const t of targets as any[]) {
      const typeIds = new Set(t.lines.map((l: any) => l.processTypeId))
      let maxSort = t.rules.reduce((s: number, r: any) => Math.max(s, r.sortOrder), -1)
      let copied = 0, skippedNoLine = 0, skippedDuplicate = 0
      for (const r of rules as any[]) {
        if (r.processTypeId != null && !typeIds.has(r.processTypeId)) { skippedNoLine++; continue }
        if ((t.rules as any[]).some((ex: any) => sameRule(ex, r))) { skippedDuplicate++; continue }
        await tx.processRateRule.create({
          data: {
            contractId: t.id,
            processTypeId: r.processTypeId,
            trigger: r.trigger,
            minThan: r.minThan, maxThan: r.maxThan,
            widthInch: r.widthInch, machineNumber: r.machineNumber,
            amountPerThan: r.amountPerThan,
            label: r.label, active: r.active, sortOrder: ++maxSort,
          },
        })
        copied++
      }
      results.push({ contractId: t.id, version: t.version, copied, skippedNoLine, skippedDuplicate })
    }
  })

  return NextResponse.json({ ok: true, results })
}
