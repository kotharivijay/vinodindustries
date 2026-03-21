import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { del } from '@vercel/blob'

// PATCH — update item status (saved/skipped)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { status } = await req.json()

  const item = await prisma.dyeingDraftItem.update({
    where: { id: parseInt(id) },
    data: { status },
  })

  // Check if all items in batch are done
  const batch = await prisma.dyeingDraftBatch.findUnique({
    where: { id: item.batchId },
    include: { items: true },
  })

  if (batch && batch.items.every(i => i.status === 'saved' || i.status === 'skipped')) {
    await prisma.dyeingDraftBatch.update({
      where: { id: batch.id },
      data: { status: 'completed' },
    })
    // Clean up blobs
    for (const i of batch.items) {
      try { await del(i.blobUrl) } catch {}
    }
  }

  return NextResponse.json(item)
}
