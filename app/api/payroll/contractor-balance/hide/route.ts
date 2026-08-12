import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST /api/payroll/contractor-balance/hide
// Body: { contractorId, monthKey, hidden }
//
// Per-MONTH hide of a contractor section on the wages page. Stored on
// ContractorMonthlyBalance.hiddenInWages (keyed by contractorId+monthKey),
// so hiding a contractor in one month leaves other months untouched. The
// legacy Contractor.hiddenInWages flag is not written here.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { contractorId?: string; monthKey?: string; hidden?: boolean }
  const contractorId = (body.contractorId || '').trim()
  const monthKey = (body.monthKey || '').trim()
  const hidden = body.hidden === true
  if (!contractorId || !monthKey) {
    return Response.json({ error: 'contractorId and monthKey are required' }, { status: 400 })
  }

  const row = await prisma.contractorMonthlyBalance.upsert({
    where: { contractorId_monthKey: { contractorId, monthKey } },
    update: { hiddenInWages: hidden },
    create: { contractorId, monthKey, hiddenInWages: hidden },
  })

  return Response.json({ ok: true, contractorId, monthKey, hidden: row.hiddenInWages })
}
