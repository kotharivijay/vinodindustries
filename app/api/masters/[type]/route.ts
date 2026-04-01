import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeName, findSimilar } from '@/lib/nameUtils'

const ALLOWED = ['parties', 'qualities', 'weavers', 'transports'] as const
type MasterType = typeof ALLOWED[number]

function getModel(type: MasterType) {
  const map = {
    parties: prisma.party,
    qualities: prisma.quality,
    weavers: prisma.weaver,
    transports: prisma.transport,
  }
  return map[type]
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type } = await params
  if (!ALLOWED.includes(type as MasterType))
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const items = await (getModel(type as MasterType) as any).findMany({
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type } = await params
  if (!ALLOWED.includes(type as MasterType))
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const { name, force } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  // Normalize: strip extra spaces, quotes, lowercase-compare
  const normalized = normalizeName(name)
  const savedName = name.replace(/\s+/g, ' ').replace(/["""''`″′]/g, '').trim()

  // Load all existing to check for duplicates / similarities
  const existing = await (getModel(type as MasterType) as any).findMany({
    select: { id: true, name: true },
  })

  // Exact normalized match → always reject
  const exactMatch = existing.find(
    (e: { id: number; name: string }) => normalizeName(e.name) === normalized
  )
  if (exactMatch) {
    return NextResponse.json(
      { error: `Already exists as "${exactMatch.name}"`, existingId: exactMatch.id },
      { status: 409 }
    )
  }

  // If not forced, check for similar names
  if (!force) {
    const similar = findSimilar(name, existing, 65)
    if (similar.length > 0) {
      return NextResponse.json({ needsConfirm: true, suggestions: similar }, { status: 200 })
    }
  }

  try {
    const item = await (getModel(type as MasterType) as any).create({
      data: { name: savedName },
    })
    return NextResponse.json(item, { status: 201 })
  } catch (e: any) {
    if (e.code === 'P2002')
      return NextResponse.json({ error: 'Already exists' }, { status: 409 })
    throw e
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type } = await params
  if (type !== 'parties')
    return NextResponse.json({ error: 'Tag update only supported for parties' }, { status: 400 })

  const { ids, tag } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })

  await prisma.party.updateMany({
    where: { id: { in: ids } },
    data: { tag: tag || null },
  })

  return NextResponse.json({ ok: true, updated: ids.length })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type } = await params
  if (!ALLOWED.includes(type as MasterType))
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const { id } = await req.json()
  try {
    await (getModel(type as MasterType) as any).delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.code === 'P2003')
      return NextResponse.json({ error: 'Cannot delete — used in entries' }, { status: 409 })
    throw e
  }
}
