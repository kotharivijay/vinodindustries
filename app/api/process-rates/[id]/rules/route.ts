export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any
const TRIGGERS = ['auto', 'lr', 'manual'] as const

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const rules = await db.processRateRule.findMany({
    where: { contractId: parseInt(id) },
    include: { processType: { select: { id: true, name: true, rateMode: true } } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  return NextResponse.json(rules)
}

// PUT — replace-all, mirroring how the contract PUT reconciles rate lines.
// Body: { rules: [{ processTypeId?, trigger, minThan?, maxThan?, widthInch?,
//                   machineNumber?, amountPerThan, label, active? }] }
//
// Ticks survive edits only for rules that keep their id; replace-all deletes
// and recreates, so ChallanLineRuleTick rows on removed rules cascade away —
// which is correct: a deleted rule must stop billing.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const contractId = parseInt(id)

  const contract = await db.processRateContract.findUnique({
    where: { id: contractId },
    include: { lines: { select: { processTypeId: true } } },
  })
  if (!contract) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const body = await req.json() as { rules: any[] }
  if (!Array.isArray(body.rules)) return NextResponse.json({ error: 'rules array required' }, { status: 400 })

  const typeIds = new Set(contract.lines.map((l: any) => l.processTypeId))
  const messages: string[] = []
  const rows = body.rules.map((r, i) => {
    const trigger = TRIGGERS.includes(r.trigger) ? r.trigger : null
    if (!trigger) messages.push(`Rule ${i + 1}: trigger must be auto / lr / manual`)
    const amount = Number(r.amountPerThan)
    if (!Number.isFinite(amount) || amount === 0) messages.push(`Rule ${i + 1}: amount per than must be a non-zero number`)
    const label = String(r.label ?? '').trim()
    if (!label) messages.push(`Rule ${i + 1}: label required`)
    const processTypeId = r.processTypeId != null && r.processTypeId !== '' ? Number(r.processTypeId) : null
    if (processTypeId != null && !typeIds.has(processTypeId)) {
      messages.push(`Rule ${i + 1}: contract has no rate line for that process type`)
    }
    const intOrNull = (v: any) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null)
    const minThan = intOrNull(r.minThan), maxThan = intOrNull(r.maxThan)
    if (minThan != null && maxThan != null && minThan > maxThan) messages.push(`Rule ${i + 1}: min than exceeds max than`)
    const widthInch = intOrNull(r.widthInch), machineNumber = intOrNull(r.machineNumber)
    if (trigger === 'auto' && minThan == null && maxThan == null && widthInch == null && machineNumber == null) {
      messages.push(`Rule ${i + 1}: an auto rule needs at least one condition`)
    }
    return {
      contractId, processTypeId, trigger,
      minThan, maxThan, widthInch, machineNumber,
      amountPerThan: String(amount),
      label, active: r.active !== false, sortOrder: i,
    }
  })
  if (messages.length) return NextResponse.json({ error: 'INVALID_RULES', messages }, { status: 400 })

  const saved = await db.$transaction(async (tx: any) => {
    await tx.processRateRule.deleteMany({ where: { contractId } })
    if (rows.length) await tx.processRateRule.createMany({ data: rows })
    return tx.processRateRule.findMany({
      where: { contractId },
      include: { processType: { select: { id: true, name: true, rateMode: true } } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
  })
  return NextResponse.json(saved)
}
