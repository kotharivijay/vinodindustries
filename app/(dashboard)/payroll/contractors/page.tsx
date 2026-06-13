import { prisma } from '@/lib/prisma'
import ContractorsClient from './ContractorsClient'

export const dynamic = 'force-dynamic'

export default async function ContractorsPage() {
  const raw = await prisma.contractor.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { staffContractors: true } } },
  })
  // Re-shape so ContractorsClient keeps using `_count.staff`.
  const contractors = raw.map((c) => ({
    ...c,
    _count: { staff: c._count.staffContractors },
  }))
  return <ContractorsClient initial={JSON.parse(JSON.stringify(contractors))} />
}
