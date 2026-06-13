import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { currentMonthKey } from '@/lib/payrollCalc'
import { getRegisterRows } from '@/lib/payrollRegisterData'

export const dynamic = 'force-dynamic'

// GET /api/payroll/register/export?month=YYYY-MM&format=salary|pf
// CSV download of the Salary Register in the sheet's column order. The "pf"
// format is the same register filtered to Reg (inRegister) staff only.

const HEADERS = ['STATUS', 'sn', 'code', 'employee name', 'department', 'salary', 'perday', 'DAY', 'Amount']

function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const month = (searchParams.get('month') || currentMonthKey()).trim()
  const format = (searchParams.get('format') || 'salary').toLowerCase()
  const pfOnly = format === 'pf'

  const { rows } = await getRegisterRows(month)
  const out = pfOnly ? rows.filter((r) => r.inRegister) : rows

  const lines = [HEADERS.join(',')]
  out.forEach((r, i) => {
    lines.push([
      csvCell(r.status),
      csvCell(i + 1), // re-number for this export's order
      csvCell(r.code),
      csvCell(r.name),
      csvCell(r.department),
      csvCell(r.salary || ''),
      csvCell(r.perDay || ''),
      csvCell(r.days ?? ''),
      csvCell(r.amount ?? ''),
    ].join(','))
  })
  const csv = '﻿' + lines.join('\r\n') // BOM so Excel reads UTF-8 (₹, Hindi names)

  const fname = `${pfOnly ? 'PF' : 'Salary'}Register_${month}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
