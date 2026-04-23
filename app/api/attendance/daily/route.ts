export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPetpoojaAuth, attnHeaders, PETPOOJA_PAYROLL_BASE } from '@/lib/petpooja'

export const maxDuration = 60

/**
 * GET /api/attendance/daily?date=YYYY-MM-DD&branches=112679,112680
 *
 * Fetches the "attendance_master" report from Petpooja for the selected
 * branches on the given date. Returns per-branch summaries + rows.
 *
 * If ?branches is omitted, uses the org from the saved token (single-branch).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const branchesParam = req.nextUrl.searchParams.get('branches') || ''

  let auth
  try { auth = await getPetpoojaAuth() }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }) }

  const branchIds = branchesParam
    ? branchesParam.split(',').map(b => b.trim()).filter(Boolean).map(Number).filter(Number.isFinite)
    : [auth.orgId]

  const results: any[] = []
  for (const bid of branchIds) {
    const body = {
      from_date: date,
      to_date: date,
      organization_id: auth.hoId,
      branch_id: bid,
      emp_id: null,
    }
    try {
      const res = await fetch(`${PETPOOJA_PAYROLL_BASE}/reports/attendance_master`, {
        method: 'POST',
        headers: attnHeaders(auth),
        body: JSON.stringify(body),
      })
      const text = await res.text()
      if (!res.ok) { results.push({ branchId: bid, error: `HTTP ${res.status}`, detail: text.slice(0, 300) }); continue }
      let data: any
      try { data = JSON.parse(text) } catch { results.push({ branchId: bid, error: 'Non-JSON response', body: text.slice(0, 300) }); continue }
      results.push({ branchId: bid, data })
    } catch (e: any) {
      results.push({ branchId: bid, error: e.message })
    }
  }

  return NextResponse.json({ date, results })
}
