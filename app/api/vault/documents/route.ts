import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { encrypt, encryptBuffer, generateIV } from '@/lib/vault-crypto'
import { getVaultKey } from '@/lib/vault-session'

const MAX_DB_SIZE = 5 * 1024 * 1024 // 5MB — store in DB
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB absolute max

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getVaultKey(session.user.email)
  if (!key) return NextResponse.json({ error: 'Vault locked' }, { status: 403 })

  const { entityId, fileName, fileBase64, mimeType } = await req.json()
  if (!entityId || !fileName || !fileBase64) {
    return NextResponse.json({ error: 'entityId, fileName, and fileBase64 required' }, { status: 400 })
  }

  const fileBuffer = Buffer.from(fileBase64, 'base64')
  if (fileBuffer.length > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 400 })
  }

  const iv = generateIV()
  const encFileName = encrypt(fileName, key, iv)
  const encFileData = encryptBuffer(fileBuffer, key, iv)

  const db = prisma as any
  try {
    const doc = await db.vaultDocument.create({
      data: {
        entityId: parseInt(entityId),
        encFileName,
        encFileData,
        fileSize: fileBuffer.length,
        mimeType: mimeType || 'application/octet-stream',
        iv,
      },
    })
    return NextResponse.json({ id: doc.id, fileName, fileSize: fileBuffer.length }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
