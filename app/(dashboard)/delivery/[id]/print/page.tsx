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
  return <PrintClient challan={challan} />
}
