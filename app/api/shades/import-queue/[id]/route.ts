export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { google } from 'googleapis'

const db = prisma as any

function getDriveClient() {
  const saJson = process.env.GOOGLE_DRIVE_SA_JSON
  if (!saJson) throw new Error('GOOGLE_DRIVE_SA_JSON not set')
  const sa = JSON.parse(saJson)
  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })
  return google.drive({ version: 'v3', auth })
}

// PATCH — update queue item fields (status, recipes, savedCount, etc.)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const itemId = parseInt(id)
  if (!itemId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const userId = session.user?.email ?? ''

  const existing = await db.shadeImportQueue.findFirst({
    where: { id: itemId, userId },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updateData: Record<string, unknown> = {}

  if (body.status !== undefined) updateData.status = body.status
  if (body.recipes !== undefined) updateData.recipes = body.recipes
  if (body.savedCount !== undefined) updateData.savedCount = body.savedCount
  if (body.pageLabel !== undefined) updateData.pageLabel = body.pageLabel

  const updated = await db.shadeImportQueue.update({
    where: { id: itemId },
    data: updateData,
  })

  return NextResponse.json(updated)
}

// DELETE — delete a single queue item
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const itemId = parseInt(id)
  if (!itemId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const userId = session.user?.email ?? ''

  const item = await db.shadeImportQueue.findFirst({
    where: { id: itemId, userId },
    select: { driveFileId: true },
  })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Best-effort Drive file deletion
  if (item.driveFileId) {
    try {
      const drive = getDriveClient()
      await drive.files.delete({ fileId: item.driveFileId })
    } catch (_) {}
  }

  await db.shadeImportQueue.delete({ where: { id: itemId } })
  return NextResponse.json({ ok: true })
}
