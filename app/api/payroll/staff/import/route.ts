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
  const isHeaderRow = body.hasHeader || /\b(code|employee|name|department|salary|sn|firm|group)\b/i.test(lines[0] || '')
  let startIdx = isHeaderRow ? 1 : 0

  // Parse header indices if present
  let firmIdx = -1
  let codeIdx = -1
  let nameIdx = -1
  let deptIdx = -1
  let salaryIdx = -1

  const splitCells = (l: string) => (/\t/.test(l) ? l.split('\t') : l.split(','))
    .map((c) => c.trim().replace(/^"(.*)"$/, '$1'))

  if (isHeaderRow && lines.length > 0) {
    const headerCells = splitCells(lines[0])
    const lowerHeaders = headerCells.map(h => h.toLowerCase())
    for (let idx = 0; idx < lowerHeaders.length; idx++) {
      const h = lowerHeaders[idx]
      if (h === 'firm' || h === 'group' || h === 'register group' || h === 'registergroup') {
        firmIdx = idx
      } else if (h === 'code' || h === 'emp code' || h === 'employee code' || h === 'staff code') {
        codeIdx = idx
      } else if (h === 'employee name' || h === 'staff name' || h === 'name of employee' || h === 'name') {
        nameIdx = idx
      } else if (h === 'department' || h === 'dept' || h === 'designation') {
        deptIdx = idx
      } else if (h === 'salary' || h === 'monthly salary' || h === 'base salary' || h === 'wages') {
        salaryIdx = idx
      }
    }
  }

  const hasValidHeader = (codeIdx !== -1 && nameIdx !== -1)

  const results: RowResult[] = []
  let created = 0, updated = 0, errors = 0

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i]
    const cells = splitCells(raw)

    if (cells.length < 3) {
      results.push({ code: '', name: raw, status: 'error', message: 'Too few columns' })
      errors++
      continue
    }

    let code = ''
    let name = ''
    let department = ''
    let salaryRaw = ''
    let registerGroup: string | null = null

    if (hasValidHeader) {
      code = codeIdx !== -1 ? cells[codeIdx] : ''
      name = nameIdx !== -1 ? cells[nameIdx] : ''
      department = deptIdx !== -1 ? cells[deptIdx] : ''
      salaryRaw = salaryIdx !== -1 ? cells[salaryIdx] : ''
      registerGroup = firmIdx !== -1 ? cells[firmIdx] : null
    } else {
      // Positional fallback
      const isGroup = (s: string) => /^(ksi|vi)-\d+$/i.test(s)
      const isInt = (s: string) => /^\d+$/.test(s)

      if (cells.length >= 6 && isGroup(cells[0])) {
        // Format: firm | status | sn | code | name | department | salary
        registerGroup = cells[0].toUpperCase()
        let codeIdxPos = 1
        if (isInt(cells[1]) && isInt(cells[2]) && Number(cells[1]) < 1000 && Number(cells[2]) >= 1000) {
          codeIdxPos = 2
        } else if (isInt(cells[2]) && isInt(cells[3]) && Number(cells[2]) < 1000 && Number(cells[3]) >= 1000) {
          codeIdxPos = 3
        } else {
          const foundCodeIdx = cells.findIndex((c, idx) => idx > 0 && isInt(c) && c.length >= 4)
          if (foundCodeIdx !== -1) codeIdxPos = foundCodeIdx
        }
        code = cells[codeIdxPos] || ''
        name = cells[codeIdxPos + 1] || ''
        department = cells[codeIdxPos + 2] || ''
        salaryRaw = cells[codeIdxPos + 3] || ''
      } else {
        let cursor = 0
        const first = cells[0] || ''
        const second = cells[1] || ''
        if (isInt(first) && isInt(second) && Number(first) < 10000 && Number(second) >= 1000) {
          cursor = 1
        }
        code = cells[cursor] || ''
        name = cells[cursor + 1] || ''
        department = cells[cursor + 2] || ''
        salaryRaw = cells[cursor + 3] || ''
      }
    }

    if (!code) { results.push({ code: '', name: name || raw, status: 'error', message: 'Missing code' }); errors++; continue }
    if (!name) { results.push({ code, name: '', status: 'error', message: 'Missing name' }); errors++; continue }

    const salary = Number(String(salaryRaw).replace(/[,₹\s]/g, '')) || 0

    try {
      const existing = await prisma.staff.findUnique({ where: { code: String(code) } })
      if (existing) {
        const rev = buildRevision({
          staffId: existing.id,
          field: 'REGISTER',
          oldValue: existing.monthlyBaseSalary,
          newValue: salary,
          effectiveMonth: currentMonthKey(),
          changedBy: session.user?.email ?? null,
          note: 'register paste-import',
        })

        const updateData: any = {
          name: name.trim(),
          department: department.trim() || null,
          monthlyBaseSalary: salary,
          isActive: true,
        }
        if (registerGroup !== null) {
          updateData.registerGroup = registerGroup.trim() || null
        }

        await prisma.staff.update({
          where: { code: String(code) },
          data: updateData,
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
            registerGroup: registerGroup ? registerGroup.trim() : null,
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
