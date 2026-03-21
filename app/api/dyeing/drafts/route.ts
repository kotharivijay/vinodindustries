import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { put, del } from '@vercel/blob'

// GET — get active draft batch for current user
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await prisma.dyeingDraftBatch.findFirst({
    where: { userId: session.user.email, status: 'active' },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(batch)
}

// POST — create new draft batch with images
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { images } = await req.json()
  // images: Array<{ base64: string, mediaType: string }>
  if (!images?.length) return NextResponse.json({ error: 'No images provided' }, { status: 400 })

  // Upload each image to Vercel Blob
  const blobResults = await Promise.all(
    images.map(async (img: { base64: string; mediaType: string }, idx: number) => {
      const ext = img.mediaType.includes('png') ? 'png' : 'jpg'
      const buffer = Buffer.from(img.base64, 'base64')
      const blob = await put(`dyeing-drafts/${Date.now()}-${idx}.${ext}`, buffer, {
        access: 'public',
        contentType: img.mediaType,
      })
      return { blobUrl: blob.url, mediaType: img.mediaType, sortOrder: idx }
    })
  )

  // Create batch in DB
  const batch = await prisma.dyeingDraftBatch.create({
    data: {
      userId: session.user.email,
      items: {
        create: blobResults.map(r => ({
          blobUrl: r.blobUrl,
          mediaType: r.mediaType,
          sortOrder: r.sortOrder,
        })),
      },
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  })

  return NextResponse.json(batch, { status: 201 })
}

// DELETE — discard active draft batch
export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await prisma.dyeingDraftBatch.findFirst({
    where: { userId: session.user.email, status: 'active' },
    include: { items: true },
  })

  if (!batch) return NextResponse.json({ ok: true })

  // Delete blobs
  for (const item of batch.items) {
    try { await del(item.blobUrl) } catch {}
  }

  // Delete batch from DB
  await prisma.dyeingDraftBatch.delete({ where: { id: batch.id } })

  return NextResponse.json({ ok: true })
}
