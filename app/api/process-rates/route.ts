export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { lineInclude, dec, validateLines, lineData, VALIDITY_UNITS, type LineInput } from '@/lib/processRates'

// GET /api/process-rates — register: every contract (all versions) with lines,
// party, and linked lots. Frontend groups by party and version. Ordered party
// name → newest version first.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contracts = await (prisma as any).processRateContract.findMany({
    include: {
      ...lineInclude,
      party: { select: { id: true, name: true } },
      greyEntries: {
        select: { id: true, lotNo: true, than: true, date: true, qualityId: true },
        orderBy: { date: 'desc' },
      },
    },
    orderBy: [{ party: { name: 'asc' } }, { version: 'desc' }],
  })
  return NextResponse.json(contracts)
}

// POST /api/process-rates — create a new rate version for a party.
// Supersedes the party's current active contract (if any) and inserts
// version+1 as the new active one. Old versions are retained as history.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    partyId: number
    effectiveFrom: string
    validityQty?: string | number | null
    validityUnit?: string | null
    notes?: string | null
    lines: LineInput[]
  }

  if (!body.partyId) return NextResponse.json({ error: 'Party required' }, { status: 400 })
  if (!body.effectiveFrom) return NextResponse.json({ error: 'Effective-from date required' }, { status: 400 })
  const validityUnit = body.validityUnit && (VALIDITY_UNITS as readonly string[]).includes(body.validityUnit)
    ? body.validityUnit : null

  try {
    const created = await (prisma as any).$transaction(async (tx: any) => {
      const err = await validateLines(tx, body.lines)
      if (err) throw new Error(err)

      const active = await tx.processRateContract.findFirst({
        where: { partyId: body.partyId, status: 'active' },
      })
      const maxVer = await tx.processRateContract.aggregate({
        where: { partyId: body.partyId }, _max: { version: true },
      })
      const nextVersion = (maxVer._max.version ?? 0) + 1

      if (active) {
        await tx.processRateContract.update({
          where: { id: active.id },
          data: { status: 'superseded', supersededAt: new Date() },
        })
      }

      return tx.processRateContract.create({
        data: {
          partyId: body.partyId,
          version: nextVersion,
          status: 'active',
          effectiveFrom: new Date(body.effectiveFrom),
          validityQty: dec(body.validityQty),
          validityUnit,
          notes: body.notes?.trim() || null,
          createdByEmail: (session.user as any)?.email ?? null,
          lines: { create: body.lines.map(lineData) },
        },
        include: lineInclude,
      })
    })
    return NextResponse.json(created)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }
}
