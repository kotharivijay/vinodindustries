import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (action === 'duplicate-parties') {
    const parties = await prisma.party.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
    const seen = new Map<string, { id: number; name: string }>()
    const duplicates: { keep: { id: number; name: string }; remove: { id: number; name: string } }[] = []
    for (const p of parties) {
      const key = p.name.toLowerCase().trim()
      if (seen.has(key)) {
        duplicates.push({ keep: seen.get(key)!, remove: p })
      } else {
        seen.set(key, p)
      }
    }
    return NextResponse.json({ total: parties.length, duplicates })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  if (data.action === 'merge-parties') {
    const { keepId, removeId } = data
    if (!keepId || !removeId) return NextResponse.json({ error: 'keepId and removeId required' }, { status: 400 })

    const db = prisma as any

    // Update all references from removeId -> keepId
    const updates: string[] = []

    // GreyEntry.partyId
    try {
      const r = await prisma.greyEntry.updateMany({ where: { partyId: removeId }, data: { partyId: keepId } })
      if (r.count) updates.push(`GreyEntry: ${r.count}`)
    } catch {}

    // FinishRecipe.partyId
    try {
      const r = await db.finishRecipe.updateMany({ where: { partyId: removeId }, data: { partyId: keepId } })
      if (r.count) updates.push(`FinishRecipe: ${r.count}`)
    } catch {}

    // FinishRecipeTag.partyId
    try {
      const r = await db.finishRecipeTag.updateMany({ where: { partyId: removeId }, data: { partyId: keepId } })
      if (r.count) updates.push(`FinishRecipeTag: ${r.count}`)
    } catch {}

    // DespatchEntry.partyId
    try {
      const r = await db.despatchEntry.updateMany({ where: { partyId: removeId }, data: { partyId: keepId } })
      if (r.count) updates.push(`DespatchEntry: ${r.count}`)
    } catch {}

    // FoldProgram.partyId
    try {
      const r = await db.foldProgram.updateMany({ where: { partyId: removeId }, data: { partyId: keepId } })
      if (r.count) updates.push(`FoldProgram: ${r.count}`)
    } catch {}

    // InventoryItemAlias.partyId
    try {
      const r = await db.inventoryItemAlias.updateMany({ where: { partyId: removeId }, data: { partyId: keepId } })
      if (r.count) updates.push(`InventoryItemAlias: ${r.count}`)
    } catch {}

    // Delete the duplicate party
    try {
      await prisma.party.delete({ where: { id: removeId } })
      updates.push('Party deleted')
    } catch (e: any) {
      return NextResponse.json({ error: `Cannot delete party ${removeId}: ${e.message}`, updates }, { status: 500 })
    }

    return NextResponse.json({ ok: true, updates })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
