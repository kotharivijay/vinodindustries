import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

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

export async function GET(_req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!ALLOWED.includes(params.type as MasterType))
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const items = await (getModel(params.type as MasterType) as any).findMany({
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!ALLOWED.includes(params.type as MasterType))
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  try {
    const item = await (getModel(params.type as MasterType) as any).create({
      data: { name: name.trim() },
    })
    return NextResponse.json(item, { status: 201 })
  } catch (e: any) {
    if (e.code === 'P2002')
      return NextResponse.json({ error: 'Already exists' }, { status: 409 })
    throw e
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!ALLOWED.includes(params.type as MasterType))
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const { id } = await req.json()
  try {
    await (getModel(params.type as MasterType) as any).delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.code === 'P2003')
      return NextResponse.json({ error: 'Cannot delete — used in entries' }, { status: 409 })
    throw e
  }
}
