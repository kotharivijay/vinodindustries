import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entries = await prisma.dyeingEntry.findMany({
    include: { chemicals: { include: { chemical: true } } },
    orderBy: { date: 'desc' },
  })
  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  if (!data.date || !data.slipNo || !data.lotNo || !data.than) {
    return NextResponse.json({ error: 'Date, Slip No, Lot No and Than are required.' }, { status: 400 })
  }

  // If marka has multiple lots, create one entry per lot (same slip, same chemicals)
  const lots = data.marka?.length
    ? data.marka.map((m: any) => ({ lotNo: String(m.lotNo).trim(), than: parseInt(m.than) || 0 }))
    : [{ lotNo: String(data.lotNo).trim(), than: parseInt(data.than) }]

  const chemData = data.chemicals?.length
    ? data.chemicals.map((c: any) => ({
        chemicalId: c.chemicalId ?? null,
        name: c.name,
        quantity: c.quantity != null ? parseFloat(c.quantity) : null,
        unit: c.unit || 'kg',
        rate: c.rate != null ? parseFloat(c.rate) : null,
        cost: c.cost != null ? parseFloat(c.cost) : null,
      }))
    : []

  const entries = []
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i]
    const entry = await prisma.dyeingEntry.create({
      data: {
        date: new Date(data.date),
        slipNo: parseInt(data.slipNo),
        lotNo: lot.lotNo,
        than: lot.than,
        notes: data.notes || null,
        // Only first lot gets chemicals — consumed once from stock
        chemicals: i === 0 && chemData.length ? { create: chemData } : undefined,
      },
      include: { chemicals: { include: { chemical: true } } },
    })
    entries.push(entry)
  }
  const entry = entries[0]

  // ── Learn aliases: save OCR name → master chemical mapping ──
  if (data.chemicals?.length && data.ocrNames?.length) {
    try {
      const db = prisma as any
      const aliasOps = []
      for (let i = 0; i < data.chemicals.length; i++) {
        const chem = data.chemicals[i]
        const ocrRaw = data.ocrNames[i]
        if (!ocrRaw || !chem.chemicalId) continue
        const ocrNorm = ocrRaw.toLowerCase().trim().replace(/\s+/g, ' ')
        const finalNorm = chem.name.toLowerCase().trim().replace(/\s+/g, ' ')
        // Only save alias if OCR name differs from final master name
        if (ocrNorm && ocrNorm !== finalNorm) {
          aliasOps.push(
            db.chemicalAlias.upsert({
              where: { ocrName: ocrNorm },
              create: { ocrName: ocrNorm, chemicalId: chem.chemicalId },
              update: { chemicalId: chem.chemicalId, hitCount: { increment: 1 } },
            })
          )
        }
      }
      if (aliasOps.length) await Promise.all(aliasOps)
    } catch {
      // ChemicalAlias table may not exist yet — skip
    }
  }

  return NextResponse.json(entry, { status: 201 })
}
