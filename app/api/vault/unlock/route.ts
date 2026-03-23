import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { verifyPassword, deriveKey, hashPassword, generateSalt, decrypt, encrypt, decryptBuffer, encryptBuffer } from '@/lib/vault-crypto'
import { setVaultKey, isVaultUnlocked, clearVaultKey } from '@/lib/vault-session'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  let configured = false
  try {
    const config = await db.vaultConfig.findFirst()
    configured = !!config
  } catch {}

  return NextResponse.json({
    unlocked: isVaultUnlocked(session.user.email),
    configured,
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { password } = await req.json()
  if (!password) return NextResponse.json({ error: 'Password required' }, { status: 400 })

  const db = prisma as any
  let config: any
  try {
    config = await db.vaultConfig.findFirst()
  } catch {
    return NextResponse.json({ error: 'Vault not configured' }, { status: 400 })
  }
  if (!config) return NextResponse.json({ error: 'Vault not configured' }, { status: 400 })

  if (!verifyPassword(password, config.salt, config.passwordHash)) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 403 })
  }

  const key = deriveKey(password, config.salt)
  setVaultKey(session.user.email, key)

  return NextResponse.json({ ok: true })
}

// PUT — change vault password
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { currentPassword, newPassword } = await req.json()
  if (!currentPassword || !newPassword) return NextResponse.json({ error: 'Both passwords required' }, { status: 400 })
  if (newPassword.length < 6) return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })

  const db = prisma as any
  let config: any
  try { config = await db.vaultConfig.findFirst() } catch { return NextResponse.json({ error: 'Vault not configured' }, { status: 400 }) }
  if (!config) return NextResponse.json({ error: 'Vault not configured' }, { status: 400 })

  // Verify current password
  if (!verifyPassword(currentPassword, config.salt, config.passwordHash)) {
    return NextResponse.json({ error: 'Current password is wrong' }, { status: 403 })
  }

  // Derive old key to re-encrypt all data
  const oldKey = deriveKey(currentPassword, config.salt)
  const newSalt = generateSalt()
  const newHash = hashPassword(newPassword, newSalt)
  const newKey = deriveKey(newPassword, newSalt)

  // Re-encrypt all entities
  const entities = await db.vaultEntity.findMany()
  for (const entity of entities) {
    try {
      const name = decrypt(entity.encName, oldKey, entity.iv)
      const details = decrypt(entity.encDetails, oldKey, entity.iv)
      const encName = encrypt(name, newKey, entity.iv)
      const encDetails = encrypt(details, newKey, entity.iv)
      await db.vaultEntity.update({ where: { id: entity.id }, data: { encName, encDetails } })
    } catch { /* skip if decryption fails */ }
  }

  // Re-encrypt all documents (filenames, tags, descriptions, file data)
  const docs = await db.vaultDocument.findMany()
  for (const doc of docs) {
    try {
      const updates: any = {}
      updates.encFileName = encrypt(decrypt(doc.encFileName, oldKey, doc.iv), newKey, doc.iv)
      if (doc.encTags) updates.encTags = encrypt(decrypt(doc.encTags, oldKey, doc.iv), newKey, doc.iv)
      if (doc.encDescription) updates.encDescription = encrypt(decrypt(doc.encDescription, oldKey, doc.iv), newKey, doc.iv)
      if (doc.encFileData) {
        const fileBuffer = decryptBuffer(doc.encFileData, oldKey, doc.iv)
        updates.encFileData = encryptBuffer(fileBuffer, newKey, doc.iv)
      }
      await db.vaultDocument.update({ where: { id: doc.id }, data: updates })
    } catch { /* skip if decryption fails */ }
  }

  // Update vault config with new password hash + salt
  await db.vaultConfig.update({ where: { id: config.id }, data: { passwordHash: newHash, salt: newSalt } })

  // Update session key
  setVaultKey(session.user.email, newKey)

  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  clearVaultKey(session.user.email)
  return NextResponse.json({ ok: true })
}
