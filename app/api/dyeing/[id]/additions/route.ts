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
  const res = await drive.files.list({
    q: `name='${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  })
  if (res.data.files?.length) return res.data.files[0].id!
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const entryId = parseInt(id)
  if (isNaN(entryId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const db = prisma as any
  const additions = await db.dyeingAddition.findMany({
    where: { entryId },
    include: {
      chemicals: { include: { chemical: true } },
      machine: true,
      operator: true,
    },
    orderBy: { roundNo: 'asc' },
  })

  return NextResponse.json(additions)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const entryId = parseInt(id)
  if (isNaN(entryId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const db = prisma as any

  // Verify entry exists
  const entry = await db.dyeingEntry.findUnique({ where: { id: entryId } })
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  const body = await req.json()
  const { type, roundNo, defectType, defectPhoto, reason, time, machineId, operatorId, chemicals } = body

  let defectPhotoUrl: string | null = null
  let defectDriveId: string | null = null

  // Upload defect photo to Drive if provided
  if (defectPhoto) {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
    let drive: ReturnType<typeof getDriveClient> | null = null
    try { drive = getDriveClient() } catch (_) { /* Drive unavailable */ }

    if (drive && folderId) {
      try {
        const defectsFolder = await findOrCreateFolder(drive, folderId, 'Dyeing Defects')
        const dateStr = new Date().toISOString().slice(0, 10)
        const dateFolder = await findOrCreateFolder(drive, defectsFolder, dateStr)

        const buffer = Buffer.from(defectPhoto, 'base64')
        const stream = Readable.from(buffer)
        const fileName = `defect-${entryId}-round${roundNo}-${Date.now()}.jpg`

        const fileRes = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [dateFolder],
            mimeType: 'image/jpeg',
          },
          media: { mimeType: 'image/jpeg', body: stream },
          fields: 'id,webViewLink',
        })

        defectDriveId = fileRes.data.id ?? null
        defectPhotoUrl = fileRes.data.webViewLink ?? null
      } catch (e) {
        console.error('Drive upload failed for defect photo:', e)
      }
    }
  }

  // Create the addition
  const chemData = (chemicals ?? []).map((c: any) => ({
    chemicalId: c.chemicalId ?? null,
    name: c.name,
    quantity: parseFloat(c.quantity) || 0,
    unit: c.unit || 'kg',
    rate: c.rate != null ? parseFloat(c.rate) : null,
    cost: c.cost != null ? parseFloat(c.cost) : null,
  }))

  const addition = await db.dyeingAddition.create({
    data: {
      entryId,
      roundNo: parseInt(roundNo) || (entry.totalRounds + 1),
      type: type || 'addition',
      defectType: defectType || null,
      defectPhoto: defectPhotoUrl,
      defectDriveId: defectDriveId,
      reason: reason || null,
      time: time || null,
      machineId: machineId ? parseInt(machineId) : null,
      operatorId: operatorId ? parseInt(operatorId) : null,
      chemicals: chemData.length > 0 ? { create: chemData } : undefined,
    },
    include: {
      chemicals: { include: { chemical: true } },
      machine: true,
      operator: true,
    },
  })

  // Increment totalRounds for both addition and re-dye
  if (type === 're-dye') {
    await db.dyeingEntry.update({
      where: { id: entryId },
      data: {
        status: 'patchy',
        totalRounds: { increment: 1 },
      },
    })
  } else {
    await db.dyeingEntry.update({
      where: { id: entryId },
      data: {
        totalRounds: { increment: 1 },
      },
    })
  }

  return NextResponse.json(addition, { status: 201 })
}
