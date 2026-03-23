import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { encrypt, decrypt, generateIV } from '@/lib/vault-crypto'
import { getVaultKey } from '@/lib/vault-session'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getVaultKey(session.user.email)
  if (!key) return NextResponse.json({ error: 'Vault locked' }, { status: 403 })

  const search = req.nextUrl.searchParams.get('search')?.toLowerCase().trim()

  const db = prisma as any

  if (search) {
    // Global document search mode
    try {
      const entities = await db.vaultEntity.findMany({
        include: { documents: true },
      })

      const results: any[] = []
      for (const entity of entities) {
        let entityName: string
        try { entityName = decrypt(entity.encName, key, entity.iv) } catch { continue }

        for (const doc of entity.documents) {
          let fileName = '', tags = '', description = ''
          try {
            fileName = decrypt(doc.encFileName, key, doc.iv)
            if (doc.encTags) tags = decrypt(doc.encTags, key, doc.iv)
            if (doc.encDescription) description = decrypt(doc.encDescription, key, doc.iv)
          } catch { continue }

          const searchable = `${fileName} ${tags} ${description} ${entityName}`.toLowerCase()
          if (searchable.includes(search)) {
            results.push({
              docId: doc.id,
              fileName,
              tags,
              description,
              fileSize: doc.fileSize,
              mimeType: doc.mimeType,
              expiryDate: doc.expiryDate,
              entityId: entity.id,
              entityName,
              entityType: entity.type,
              createdAt: doc.createdAt,
            })
          }
        }
      }

      return NextResponse.json({ search: true, results })
    } catch {
      return NextResponse.json({ search: true, results: [] })
    }
  }

  // Normal entity list mode
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
