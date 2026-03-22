import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const db = prisma as any

// GET — fetch a single draft item's image data
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  try {
    const item = await db.dyeingDraftItem.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, imageBase64: true, mediaType: true, status: true },
    })
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

// PATCH — update item status (saved/skipped)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { status } = await req.json()

  try {
    const item = await db.dyeingDraftItem.update({
      where: { id: parseInt(id) },
      data: { status },
    })

    // Check if all items in batch are done → mark batch completed and delete
    const batch = await db.dyeingDraftBatch.findUnique({
      where: { id: item.batchId },
      include: { items: { select: { status: true } } },
    })

    if (batch && batch.items.every((i: any) => i.status === 'saved' || i.status === 'skipped')) {
      await db.dyeingDraftBatch.delete({ where: { id: batch.id } })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
