export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

const DEFAULT_TAGS = [
  'Dyes & Auxiliary',
  'Machinery',
  'Packing Material',
  'Fuel',
  'Transport',
  'Employee',
  'Customer',
  'Pali PC Job',
  'Job Party',
]

// Tags that should also create/update a Party row in the web app's Party master.
const PARTY_TAGS = new Set(['Pali PC Job', 'Job Party', 'Local', 'Direct', 'Commission'])

async function upsertPartyForLedger(ledgerId: number, tag: string) {
  if (!PARTY_TAGS.has(tag)) return
  const ledger = await db.tallyLedger.findUnique({ where: { id: ledgerId }, select: { name: true } })
  if (!ledger?.name) return
  const existing = await db.party.findUnique({ where: { name: ledger.name }, select: { id: true, tag: true } })
  if (!existing) {
    await db.party.create({ data: { name: ledger.name, tag } })
  } else if (!existing.tag) {
    await db.party.update({ where: { id: existing.id }, data: { tag } })
  }
  // If party exists with a different tag, leave it alone.
}

// GET — list ledgers with tags, or get all unique tags
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const action = req.nextUrl.searchParams.get('action')
  const tag = req.nextUrl.searchParams.get('tag')

  // Get all unique tags used
  if (action === 'all-tags') {
    const ledgers = await db.tallyLedger.findMany({
      where: { firmCode: 'KSI', tags: { isEmpty: false } },
      select: { tags: true },
    })
    const tagSet = new Set<string>(DEFAULT_TAGS)
    for (const l of ledgers) {
      for (const t of l.tags) tagSet.add(t)
    }
    return NextResponse.json(Array.from(tagSet).sort())
  }

  // Get ledgers by tag
  if (tag) {
    const ledgers = await db.tallyLedger.findMany({
      where: { firmCode: 'KSI', tags: { has: tag } },
      select: { id: true, name: true, parent: true, mobileNos: true, tags: true, closingBalance: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(ledgers)
  }

  // Get all tagged ledgers summary
  const ledgers = await db.tallyLedger.findMany({
    where: { firmCode: 'KSI', tags: { isEmpty: false } },
    select: { id: true, name: true, parent: true, tags: true },
    orderBy: { name: 'asc' },
  })

  // Count per tag
  const tagCounts: Record<string, number> = {}
  for (const t of DEFAULT_TAGS) tagCounts[t] = 0
  for (const l of ledgers) {
    for (const t of l.tags) tagCounts[t] = (tagCounts[t] || 0) + 1
  }

  return NextResponse.json({ ledgers, tagCounts })
}

// POST — add/remove tags
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, ledgerIds, tag } = await req.json()

  if (!tag || !ledgerIds?.length) return NextResponse.json({ error: 'tag and ledgerIds required' }, { status: 400 })

  if (action === 'add-tag') {
    for (const id of ledgerIds) {
      const ledger = await db.tallyLedger.findUnique({ where: { id: parseInt(id) }, select: { tags: true } })
      if (ledger && !ledger.tags.includes(tag)) {
        await db.tallyLedger.update({
          where: { id: parseInt(id) },
          data: { tags: [...ledger.tags, tag] },
        })
      }
      await upsertPartyForLedger(parseInt(id), tag)
    }
    return NextResponse.json({ ok: true, count: ledgerIds.length })
  }

  if (action === 'remove-tag') {
    for (const id of ledgerIds) {
      const ledger = await db.tallyLedger.findUnique({ where: { id: parseInt(id) }, select: { tags: true } })
      if (ledger) {
        await db.tallyLedger.update({
          where: { id: parseInt(id) },
          data: { tags: ledger.tags.filter((t: string) => t !== tag) },
        })
      }
    }
    return NextResponse.json({ ok: true, count: ledgerIds.length })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
