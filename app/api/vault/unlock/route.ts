import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { verifyPassword, deriveKey } from '@/lib/vault-crypto'
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

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  clearVaultKey(session.user.email)
  return NextResponse.json({ ok: true })
}
