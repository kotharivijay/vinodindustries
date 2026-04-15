export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { google } from 'googleapis'
import { Readable } from 'stream'

export const maxDuration = 60

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

async function findOrCreateFolder(drive: ReturnType<typeof getDriveClient>, parentId: string, folderName: string): Promise<string> {
  // Search for existing folder
  const res = await drive.files.list({
    q: `name='${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  })
  if (res.data.files?.length) return res.data.files[0].id!

  // Create folder
  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      parents: [parentId],
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  })
  return created.data.id!
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const entryId = parseInt(id)
  if (isNaN(entryId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const body = await req.json()
  const { imageBase64, mediaType, date, notes, colorC, colorM, colorY, colorK, colorHex } = body

  const db = prisma as any

  // Verify entry exists
  const entry = await db.dyeingEntry.findUnique({ where: { id: entryId } })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let dyeingPhotoUrl: string | null = null
  let dyeingDriveId: string | null = null

  // Upload image to Google Drive if provided
  if (imageBase64) {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
    let drive: ReturnType<typeof getDriveClient> | null = null
    try {
      drive = getDriveClient()
    } catch (_) {
      // Drive unavailable
    }

    if (drive && folderId) {
      try {
        // Create subfolder: Dyeing Photos/{date}
        const dyeingPhotosFolder = await findOrCreateFolder(drive, folderId, 'Dyeing Photos')
        const dateFolder = await findOrCreateFolder(drive, dyeingPhotosFolder, date || new Date().toISOString().slice(0, 10))

        const buffer = Buffer.from(imageBase64, 'base64')
        const stream = Readable.from(buffer)
        const ext = mediaType === 'image/png' ? 'png' : 'jpg'
        const fileName = `dyeing-${entryId}-slip${entry.slipNo}-${Date.now()}.${ext}`

        const fileRes = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [dateFolder],
            mimeType: mediaType || 'image/jpeg',
          },
          media: {
            mimeType: mediaType || 'image/jpeg',
            body: stream,
          },
          fields: 'id,webViewLink',
        })

        dyeingDriveId = fileRes.data.id ?? null
        dyeingPhotoUrl = fileRes.data.webViewLink ?? null
      } catch (e) {
        console.error('Drive upload failed for dyeing confirm:', e)
      }
    }
  }

  // Update the dyeing entry
  const updated = await db.dyeingEntry.update({
    where: { id: entryId },
    data: {
      dyeingDoneAt: date ? new Date(date) : new Date(),
      dyeingPhotoUrl,
      dyeingDriveId,
      dyeingNotes: notes || null,
      colorC: colorC != null ? parseFloat(colorC) : null,
      colorM: colorM != null ? parseFloat(colorM) : null,
      colorY: colorY != null ? parseFloat(colorY) : null,
      colorK: colorK != null ? parseFloat(colorK) : null,
      colorHex: colorHex || null,
    },
  })

  return NextResponse.json(updated)
}
