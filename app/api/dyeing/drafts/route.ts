export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const db = prisma as any

// GET — get active draft batch for current user (return items WITHOUT imageBase64 for speed)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json(null)

  try {
    const batch = await db.dyeingDraftBatch.findFirst({
      where: { userId: session.user.email, status: 'active' },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, mediaType: true, status: true, sortOrder: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(batch)
  } catch {
    return NextResponse.json(null)
  }
}

// POST — create new draft batch with images (base64 stored in DB)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { images } = await req.json()
  if (!images?.length) return NextResponse.json({ error: 'No images provided' }, { status: 400 })

  try {
    const batch = await db.dyeingDraftBatch.create({
      data: {
        userId: session.user.email,
        items: {
          create: images.map((img: { base64: string; mediaType: string }, idx: number) => ({
            imageBase64: img.base64,
            mediaType: img.mediaType || 'image/jpeg',
            sortOrder: idx,
          })),
        },
      },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, mediaType: true, status: true, sortOrder: true },
        },
      },
    })
    return NextResponse.json(batch, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to save drafts' }, { status: 500 })
  }
}

// DELETE — discard active draft batch
export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const batch = await db.dyeingDraftBatch.findFirst({
      where: { userId: session.user.email, status: 'active' },
    })
    if (batch) {
      await db.dyeingDraftBatch.delete({ where: { id: batch.id } })
    }
  } catch {}

  return NextResponse.json({ ok: true })
}
