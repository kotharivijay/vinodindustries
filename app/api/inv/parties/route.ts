export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase()
  const withTags = req.nextUrl.searchParams.get('withTags') === 'true'
  const where: any = { active: true }
  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { tallyLedger: { contains: q, mode: 'insensitive' } },
    ]
  }
  const parties = await db.invParty.findMany({
    where,
    orderBy: { displayName: 'asc' },
    take: 200,
  })

  // Enrich each party with tags from TallyLedger (KSI firm) by name match.
  // When withTags=true, filter to only parties that have at least one tag.
  const names = parties.map((p: any) => p.tallyLedger)
  const ledgers = names.length
    ? await db.tallyLedger.findMany({
        where: { firmCode: 'KSI', name: { in: names } },
        select: { name: true, tags: true, parent: true },
      })
    : []
  const ledgerByName = new Map(ledgers.map((l: any) => [l.name, l]))
  const enriched = parties.map((p: any) => {
    const led = ledgerByName.get(p.tallyLedger) as { tags?: string[]; parent?: string | null } | undefined
    return {
      ...p,
      tags: led?.tags || [],
      // Prefer the live parent from ledger master; fall back to synced parentGroup
      parentGroup: led?.parent ?? p.parentGroup,
    }
  })
  const filtered = withTags ? enriched.filter((p: any) => p.tags.length > 0) : enriched
  return NextResponse.json(filtered)
}

export async function PATCH(req: NextRequest) {
  // Edit a single party's editable fields (whatsapp, gstRegistrationType override)
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, whatsapp, email, city, gstRegistrationType } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const data: any = {}
  if (whatsapp !== undefined) data.whatsapp = whatsapp || null
  if (email !== undefined) data.email = email || null
  if (city !== undefined) data.city = city || null
  if (gstRegistrationType && ['Regular', 'Composition', 'Unregistered'].includes(gstRegistrationType)) {
    data.gstRegistrationType = gstRegistrationType
  }
  const updated = await db.invParty.update({ where: { id: Number(id) }, data })
  return NextResponse.json(updated)
}
