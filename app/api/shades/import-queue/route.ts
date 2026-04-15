export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { google } from 'googleapis'
import { Readable } from 'stream'

export const maxDuration = 60

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

// GET — list all queue items for current user ordered by sortOrder
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = await db.shadeImportQueue.findMany({
    where: { userId: session.user?.email ?? '' },
    orderBy: { sortOrder: 'asc' },
  })
  return NextResponse.json(items)
}

// DELETE — clear all queue items for current user
export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user?.email ?? ''

  // Also delete Drive files for items that have driveFileId
  const items = await db.shadeImportQueue.findMany({
    where: { userId },
    select: { driveFileId: true },
  })

  if (items.length > 0) {
    try {
      const drive = getDriveClient()
      await Promise.allSettled(
        items
          .filter((i: any) => i.driveFileId)
          .map((i: any) => drive.files.delete({ fileId: i.driveFileId }))
      )
    } catch (_) {
      // Drive cleanup is best-effort
    }
  }

  await db.shadeImportQueue.deleteMany({ where: { userId } })
  return NextResponse.json({ ok: true })
}

// POST — add images to queue + upload to Google Drive
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user?.email ?? ''
  const { images } = await req.json() as {
    images: { base64: string; mediaType: string; pageLabel?: string }[]
  }

  if (!images?.length) return NextResponse.json({ error: 'No images provided' }, { status: 400 })

  // Get current max sortOrder for this user
  const maxItem = await db.shadeImportQueue.findFirst({
    where: { userId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  let nextOrder = (maxItem?.sortOrder ?? -1) + 1

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID

  let drive: ReturnType<typeof getDriveClient> | null = null
  try {
    drive = getDriveClient()
  } catch (_) {
    // Drive unavailable — continue without upload
  }

  const created: any[] = []

  for (const img of images) {
    let driveFileId: string | null = null
    let driveUrl: string | null = null

    if (drive && folderId) {
      try {
        // Convert base64 to buffer stream
        const buffer = Buffer.from(img.base64, 'base64')
        const stream = Readable.from(buffer)

        const ext = img.mediaType === 'image/png' ? 'png' : img.mediaType === 'image/webp' ? 'webp' : 'jpg'
        const fileName = `shade-import-${userId}-${Date.now()}.${ext}`

        const fileRes = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [folderId],
            mimeType: img.mediaType,
          },
          media: {
            mimeType: img.mediaType,
            body: stream,
          },
          fields: 'id,webViewLink',
        })

        driveFileId = fileRes.data.id ?? null
        driveUrl = fileRes.data.webViewLink ?? null
      } catch (e) {
        console.error('Drive upload failed for image:', e)
      }
    }

    const item = await db.shadeImportQueue.create({
      data: {
        userId,
        imageBase64: img.base64,
        mediaType: img.mediaType || 'image/jpeg',
        pageLabel: img.pageLabel ?? null,
        driveFileId,
        driveUrl,
        status: 'pending',
        sortOrder: nextOrder++,
      },
    })
    created.push(item)
  }

  return NextResponse.json({ created }, { status: 201 })
}
