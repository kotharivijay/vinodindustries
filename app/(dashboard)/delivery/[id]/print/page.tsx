import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import PrintClient from './PrintClient'

const db = prisma as any

export default async function DeliveryChallanPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const challan = await db.finishDeliveryChallan.findUnique({
    where: { id: parseInt(id) },
    include: {
      party: { select: { name: true, tag: true, gstin: true, address: true, state: true } },
      lines: { orderBy: { id: 'asc' } },
    },
  })
  if (!challan) notFound()

  // Resolve marka + source grey challan no per lot from GreyEntry (not stored
  // on the challan line). A lot may span multiple grey challans → join them.
  const lotNos = [...new Set(challan.lines.map((l: any) => l.lotNo as string))] as string[]
  const greys = lotNos.length
    ? await db.greyEntry.findMany({
        where: { lotNo: { in: lotNos } },
        select: { lotNo: true, marka: true, challanNo: true },
        orderBy: { challanNo: 'asc' },
      })
    : []
  const greyByLot = new Map<string, { marka: string | null; challanNos: Set<number> }>()
  for (const g of greys as any[]) {
    const k = g.lotNo.toLowerCase().trim()
    if (!greyByLot.has(k)) greyByLot.set(k, { marka: null, challanNos: new Set() })
    const e = greyByLot.get(k)!
    if (g.marka && !e.marka) e.marka = g.marka
    if (g.challanNo != null) e.challanNos.add(g.challanNo)
  }
  const lines = challan.lines.map((l: any) => {
    const info = greyByLot.get(l.lotNo.toLowerCase().trim())
    return { ...l, marka: info?.marka ?? null, greyChallanNo: info && info.challanNos.size ? [...info.challanNos].join(', ') : null }
  })

  return <PrintClient challan={{ ...challan, lines }} />
}
