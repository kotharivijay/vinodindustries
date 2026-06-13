import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/payroll/staff/[id]/revisions
// Salary-change history for one staff, newest first. Drives the Salary
// History panel in the staff edit modal.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const revisions = await prisma.staffSalaryRevision.findMany({
    where: { staffId: id },
    orderBy: { changedAt: 'desc' },
  })
  return Response.json(revisions)
}
