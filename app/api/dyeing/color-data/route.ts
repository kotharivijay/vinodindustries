export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Fetch all confirmed dyeing entries that have CMYK data
  const entries = await db.dyeingEntry.findMany({
    where: {
      dyeingDoneAt: { not: null },
      colorC: { not: null },
      colorM: { not: null },
      colorY: { not: null },
      colorK: { not: null },
    },
    include: {
      chemicals: {
        include: { chemical: true },
      },
      lots: true,
    },
    orderBy: { dyeingDoneAt: 'desc' },
  })

  // Calculate cost per entry
  const result = entries.map((e: any) => {
    const shadeChems = e.chemicals.filter((c: any) => c.processTag === 'shade')
    const allChems = e.chemicals
    const totalCost = allChems.reduce((sum: number, c: any) => sum + (c.cost || 0), 0)
    const shadeCost = shadeChems.reduce((sum: number, c: any) => sum + (c.cost || 0), 0)

    return {
      id: e.id,
      slipNo: e.slipNo,
      lotNo: e.lotNo,
      than: e.than,
      shadeName: e.shadeName,
      colorC: e.colorC,
      colorM: e.colorM,
      colorY: e.colorY,
      colorK: e.colorK,
      colorHex: e.colorHex,
      dyeingDoneAt: e.dyeingDoneAt,
      dyeingPhotoUrl: e.dyeingPhotoUrl,
      totalCost,
      shadeCost,
      chemicals: allChems.map((c: any) => ({
        id: c.id,
        name: c.name,
        quantity: c.quantity,
        unit: c.unit,
        rate: c.rate,
        cost: c.cost,
        processTag: c.processTag,
      })),
      shadeChemicals: shadeChems.map((c: any) => ({
        name: c.name,
        quantity: c.quantity,
        unit: c.unit,
        cost: c.cost,
      })),
    }
  })

  return NextResponse.json(result)
}
