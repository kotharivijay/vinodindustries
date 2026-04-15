export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { hashPassword, generateSalt } from '@/lib/vault-crypto'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { password } = await req.json()
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const db = prisma as any
  // Check if vault already configured
  try {
    const existing = await db.vaultConfig.findFirst()
    if (existing) return NextResponse.json({ error: 'Vault already configured' }, { status: 400 })
  } catch {}

  const salt = generateSalt()
  const hash = hashPassword(password, salt)

  try {
    await db.vaultConfig.create({ data: { passwordHash: hash, salt } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
