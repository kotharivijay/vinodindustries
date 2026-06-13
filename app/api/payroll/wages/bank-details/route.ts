import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchTallyBankDetails } from '@/lib/tallyPayroll'

export const maxDuration = 300

// GET /api/payroll/wages/bank-details?firm=VI
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const firm = (searchParams.get('firm') || 'VI').toUpperCase()

  try {
    const bankDetailsMap = await fetchTallyBankDetails(firm)
    const obj = Object.fromEntries(bankDetailsMap.entries())
    return Response.json(obj)
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
