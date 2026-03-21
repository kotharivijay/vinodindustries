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

  const entry = await prisma.dyeingEntry.create({
    data: {
      date: new Date(data.date),
      slipNo: parseInt(data.slipNo),
      lotNo: String(data.lotNo).trim(),
      than: parseInt(data.than),
      notes: data.notes || null,
      chemicals: data.chemicals?.length
        ? {
            create: data.chemicals.map((c: any) => ({
              chemicalId: c.chemicalId ?? null,
              name: c.name,
              quantity: c.quantity != null ? parseFloat(c.quantity) : null,
              unit: c.unit || 'kg',
              rate: c.rate != null ? parseFloat(c.rate) : null,
              cost: c.cost != null ? parseFloat(c.cost) : null,
            })),
          }
        : undefined,
    },
    include: { chemicals: { include: { chemical: true } } },
  })
  return NextResponse.json(entry, { status: 201 })
}
