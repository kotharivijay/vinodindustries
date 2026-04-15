export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { encrypt, decrypt } from '@/lib/vault-crypto'
import { getVaultKey } from '@/lib/vault-session'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getVaultKey(session.user.email)
  if (!key) return NextResponse.json({ error: 'Vault locked' }, { status: 403 })

  const { id } = await params
  const db = prisma as any

  try {
    const entity = await db.vaultEntity.findUnique({
      where: { id: parseInt(id) },
      include: { documents: { orderBy: { createdAt: 'desc' } } },
    })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const name = decrypt(entity.encName, key, entity.iv)
    const details = JSON.parse(decrypt(entity.encDetails, key, entity.iv))

    const docs = entity.documents.map((d: any) => {
      try {
        let tags = ''
        let description = ''
        try { if (d.encTags) tags = decrypt(d.encTags, key, d.iv) } catch {}
        try { if (d.encDescription) description = decrypt(d.encDescription, key, d.iv) } catch {}
        return {
          id: d.id,
          fileName: decrypt(d.encFileName, key, d.iv),
          tags,
          description,
          fileSize: d.fileSize,
          mimeType: d.mimeType,
          expiryDate: d.expiryDate,
          createdAt: d.createdAt,
        }
      } catch {
        return { id: d.id, fileName: '[Encrypted]', tags: '', description: '', fileSize: d.fileSize, mimeType: d.mimeType, expiryDate: d.expiryDate, createdAt: d.createdAt }
      }
    })

    return NextResponse.json({ id: entity.id, type: entity.type, name, details, documents: docs, createdAt: entity.createdAt })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getVaultKey(session.user.email)
  if (!key) return NextResponse.json({ error: 'Vault locked' }, { status: 403 })

  const { id } = await params
  const { name, details } = await req.json()
  const db = prisma as any

  try {
    const entity = await db.vaultEntity.findUnique({ where: { id: parseInt(id) } })
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const encName = name ? encrypt(name, key, entity.iv) : entity.encName
    const encDetails = details ? encrypt(JSON.stringify(details), key, entity.iv) : entity.encDetails

    await db.vaultEntity.update({
      where: { id: parseInt(id) },
      data: { encName, encDetails },
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
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
    await db.vaultEntity.delete({ where: { id: parseInt(id) } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
