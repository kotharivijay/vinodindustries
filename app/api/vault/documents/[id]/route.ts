export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { decrypt, decryptBuffer } from '@/lib/vault-crypto'
import { getVaultKey } from '@/lib/vault-session'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getVaultKey(session.user.email)
  if (!key) return NextResponse.json({ error: 'Vault locked' }, { status: 403 })

  const { id } = await params
  const db = prisma as any

  try {
    const doc = await db.vaultDocument.findUnique({ where: { id: parseInt(id) } })
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const fileName = decrypt(doc.encFileName, key, doc.iv)

    if (doc.encFileData) {
      const fileBuffer = decryptBuffer(doc.encFileData, key, doc.iv)
      return new NextResponse(new Uint8Array(fileBuffer), {
        headers: {
          'Content-Type': doc.mimeType,
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': String(fileBuffer.length),
        },
      })
    }

    return NextResponse.json({ error: 'File data not available' }, { status: 404 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Decryption failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getVaultKey(session.user.email)
  if (!key) return NextResponse.json({ error: 'Vault locked' }, { status: 403 })

  const { id } = await params
  const db = prisma as any

  try {
    await db.vaultDocument.delete({ where: { id: parseInt(id) } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
