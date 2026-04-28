export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

const DEFAULT_CONFIG = {
  purchaseLedgerMap: {
    Chemical: 'Chemical Purchase',
    Dye: 'Dye Purchase',
    Auxiliary: 'Auxiliary Purchase',
    Spare: 'Machinery Spare Purchase',
  },
  godownMap: {
    Chemical: 'Chemical Godown',
    Dye: 'Dye Godown',
    Auxiliary: 'Auxiliary Godown',
    Spare: 'Spare Godown',
  },
  gstLedgers: {
    IGST: { '5': 'Input IGST 5%', '12': 'Input IGST 12%', '18': 'Input IGST 18%', '28': 'Input IGST 28%' },
    CGST: { '2.5': 'Input CGST 2.5%', '6': 'Input CGST 6%', '9': 'Input CGST 9%', '14': 'Input CGST 14%' },
    SGST: { '2.5': 'Input SGST 2.5%', '6': 'Input SGST 6%', '9': 'Input SGST 9%', '14': 'Input SGST 14%' },
  },
}

async function ensureConfig() {
  const row = await db.invTallyConfig.findUnique({ where: { id: 1 } })
  if (row) return row
  return db.invTallyConfig.create({ data: { id: 1, ...DEFAULT_CONFIG } })
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const cfg = await ensureConfig()
  return NextResponse.json(cfg)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  await ensureConfig()
  const data: any = {}
  for (const k of ['purchaseLedgerMap', 'godownMap', 'gstLedgers'] as const) {
    if (body[k]) data[k] = body[k]
  }
  for (const k of ['roundOffLedger', 'freightLedger', 'discountLedger'] as const) {
    if (body[k]) data[k] = body[k]
  }
  const updated = await db.invTallyConfig.update({ where: { id: 1 }, data })
  return NextResponse.json(updated)
}
