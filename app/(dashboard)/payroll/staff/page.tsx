import { prisma } from '@/lib/prisma'
import StaffClient from './StaffClient'

export const dynamic = 'force-dynamic'

export default async function StaffPage() {
  const [rawStaff, contractors] = await Promise.all([
    prisma.staff.findMany({
      orderBy: { name: 'asc' },
      include: {
        staffContractors: { include: { contractor: { select: { id: true, name: true } } } },
      },
    }),
    prisma.contractor.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])
  // Flatten the join: StaffClient expects `contractors: [{id,name}]`.
  const staff = rawStaff.map((s) => ({
    ...s,
    contractors: s.staffContractors.map((sc) => ({ id: sc.contractor.id, name: sc.contractor.name })),
    staffContractors: undefined,
  }))
  return (
    <StaffClient
      initialStaff={JSON.parse(JSON.stringify(staff))}
      contractors={JSON.parse(JSON.stringify(contractors))}
    />
  )
}
