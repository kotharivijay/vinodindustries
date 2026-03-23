import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { encrypt, decrypt, generateIV } from '@/lib/vault-crypto'
import { getVaultKey } from '@/lib/vault-session'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getVaultKey(session.user.email)
  if (!key) return NextResponse.json({ error: 'Vault locked' }, { status: 403 })

  const db = prisma as any
  try {
    const entities = await db.vaultEntity.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { documents: true } } },
    })

    const decrypted = entities.map((e: any) => {
      try {
        return {
          id: e.id,
          type: e.type,
          name: decrypt(e.encName, key, e.iv),
          docCount: e._count.documents,
          createdAt: e.createdAt,
        }
      } catch {
        return { id: e.id, type: e.type, name: '[Decryption failed]', docCount: 0, createdAt: e.createdAt }
      }
    })

    return NextResponse.json(decrypted)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getVaultKey(session.user.email)
  if (!key) return NextResponse.json({ error: 'Vault locked' }, { status: 403 })

  const { type, name, details } = await req.json()
  if (!type || !name) return NextResponse.json({ error: 'Type and name required' }, { status: 400 })

  const iv = generateIV()
  const encName = encrypt(name, key, iv)
  const encDetails = encrypt(JSON.stringify(details || {}), key, iv)

  const db = prisma as any
  try {
    const entity = await db.vaultEntity.create({
      data: { type, encName, encDetails, iv },
    })
    return NextResponse.json({ id: entity.id, type, name }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
