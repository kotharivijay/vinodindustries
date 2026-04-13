import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

async function ensureDefaults() {
  const defaults = [
    { firmCode: 'KSI', firmName: 'Kothari Synthetic Industries', tallyCompanyName: 'Kothari Synthetic Industries -( from 2023)' },
  ]
  for (const d of defaults) {
    const existing = await db.tallyConfig.findUnique({ where: { firmCode: d.firmCode } })
    if (!existing) {
      await db.tallyConfig.create({
        data: {
          ...d,
          tallyTunnelUrl: process.env.TALLY_TUNNEL_URL || null,
          cfAccessClientId: process.env.CF_ACCESS_CLIENT_ID || null,
          cfAccessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET || null,
          tallyApiSecret: process.env.TALLY_API_SECRET || null,
        },
      })
    }
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureDefaults()

  const configs = await db.tallyConfig.findMany({ orderBy: { firmCode: 'asc' } })
  const logs = await db.tallySyncLog.findMany({ where: { company: 'KSI' }, orderBy: { createdAt: 'desc' }, take: 20 })

  return NextResponse.json({ configs, logs })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { firmCode, firmName, tallyCompanyName, tallyTunnelUrl, cfAccessClientId, cfAccessClientSecret, tallyApiSecret } = body

  if (!firmCode || !tallyCompanyName) return NextResponse.json({ error: 'firmCode and tallyCompanyName required' }, { status: 400 })

  const config = await db.tallyConfig.upsert({
    where: { firmCode },
    create: { firmCode, firmName: firmName || firmCode, tallyCompanyName, tallyTunnelUrl, cfAccessClientId, cfAccessClientSecret, tallyApiSecret },
    update: { firmName, tallyCompanyName, tallyTunnelUrl, cfAccessClientId, cfAccessClientSecret, tallyApiSecret },
  })

  return NextResponse.json(config)
}
