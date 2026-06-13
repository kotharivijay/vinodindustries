import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildRevision } from '@/lib/payrollRevision'
import { currentMonthKey } from '@/lib/payrollCalc'

// Bulk-paste staff register import.
//
// Body: { text: string, hasHeader?: boolean }
// Accepts TAB or comma separators. Tolerant of extra whitespace.
// Column order (from the user's Excel register):
//   sn  |  code  |  name  |  department  |  salary  |  J1 (daily rate at 30d — derived; ignored)
//
// "sn" is optional — if the first column is a small integer and the second
// looks like a 4-digit employee code, we treat sn as a leading column and
// skip it. Otherwise we treat the first column as the code.
//
// Behaviour: upsert by `code`. If a row with that code already exists we
// update name / department / monthlyBaseSalary; paymentMode and
// contractorId are NOT touched (so re-importing the register won't undo
// any contractor tagging you've already done).
//
// All imported rows default to paymentMode = SALARIED. Tag contractors
// after import via the admin UI.

type RowResult = { code: string; name: string; status: 'created' | 'updated' | 'error'; message?: string }

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { text?: string; hasHeader?: boolean }
  const text = (body.text || '').trim()
  if (!text) return Response.json({ error: 'Empty paste' }, { status: 400 })

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // Auto-detect header: first row contains any of these tokens (case-insensitive)
  let startIdx = 0
  if (body.hasHeader || /\b(code|employee|name|department|salary|sn)\b/i.test(lines[0] || '')) startIdx = 1

  const results: RowResult[] = []
  let created = 0, updated = 0, errors = 0

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i]
    // Split on tab if any tab present (Excel paste); else split on comma.
    const cells = (/\t/.test(raw) ? raw.split('\t') : raw.split(','))
      .map((c) => c.trim().replace(/^"(.*)"$/, '$1'))

    if (cells.length < 3) {
      results.push({ code: '', name: raw, status: 'error', message: 'Too few columns' })
      errors++
      continue
    }

    // Detect leading sn — if 1st col is a small int and 2nd looks like a 4-digit code, shift.
    let cursor = 0
    const first = cells[0]
    const second = cells[1]
    const isInt = (s: string) => /^\d+$/.test(s)
    if (isInt(first) && isInt(second) && Number(first) < 10000 && Number(second) >= 1000) {
      // first = sn, second = code
      cursor = 1
    }

    const code = cells[cursor]
    const name = cells[cursor + 1]
    const department = cells[cursor + 2] || ''
    const salaryRaw = cells[cursor + 3] || ''
    // (J1 / daily-rate column at cursor+4 is derived — ignored.)

    if (!code) { results.push({ code: '', name: name || raw, status: 'error', message: 'Missing code' }); errors++; continue }
    if (!name) { results.push({ code, name: '', status: 'error', message: 'Missing name' }); errors++; continue }

    const salary = Number(String(salaryRaw).replace(/[,₹\s]/g, '')) || 0

    try {
      const existing = await prisma.staff.findUnique({ where: { code: String(code) } })
      if (existing) {
        // Record a Register Salary revision when the pasted figure differs
        // from what's on file (a re-paste of the register is the common way
        // salaries get bumped).
        const rev = buildRevision({
          staffId: existing.id,
          field: 'REGISTER',
          oldValue: existing.monthlyBaseSalary,
          newValue: salary,
          effectiveMonth: currentMonthKey(),
          changedBy: session.user?.email ?? null,
          note: 'register paste-import',
        })
        await prisma.staff.update({
          where: { code: String(code) },
          data: {
            name: name.trim(),
            department: department.trim() || null,
            monthlyBaseSalary: salary,
            // paymentMode + contractorId intentionally NOT touched.
            isActive: true,
          },
        })
        if (rev) await prisma.staffSalaryRevision.create({ data: rev })
        results.push({ code: String(code), name: name.trim(), status: 'updated' })
        updated++
      } else {
        await prisma.staff.create({
          data: {
            code: String(code),
            name: name.trim(),
            department: department.trim() || null,
            monthlyBaseSalary: salary,
            paymentMode: 'SALARIED',
          },
        })
        results.push({ code: String(code), name: name.trim(), status: 'created' })
        created++
      }
    } catch (e) {
      const msg = (e as Error).message || 'Insert failed'
      results.push({ code: String(code), name: name?.trim() || '', status: 'error', message: msg.slice(0, 120) })
      errors++
    }
  }

  return Response.json({ created, updated, errors, total: lines.length - startIdx, results })
}
