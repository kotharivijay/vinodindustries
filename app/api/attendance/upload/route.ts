export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parsePunchWorkbook } from '@/lib/attendance-xlsx'

const MAX_BYTES = 10 * 1024 * 1024

/**
 * POST /api/attendance/upload  (multipart, field `file`)
 * Parses Petpooja's Daily Punch Report xlsx and stores one AttendancePunchDay
 * per (employee, date). Re-uploading a sheet replaces ONLY the dates that
 * sheet covers — other months stay as they were.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fd = await req.formData()
  const file = fd.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File larger than 10 MB' }, { status: 413 })

  let parsed
  try {
    parsed = parsePunchWorkbook(Buffer.from(await file.arrayBuffer()), { fileName: file.name })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Could not read the sheet' }, { status: 400 })
  }
  if (!parsed.days.length) return NextResponse.json({ error: 'Sheet has no employee rows' }, { status: 400 })

  const dates = [...new Set(parsed.days.map(d => d.date))].sort()
  const problemCount = Object.values(parsed.problems).reduce((s: number, n: number) => s + n, 0)
  const db = prisma as any

  // The sheet is now the only source of employees: anyone new gets a master
  // row (so they can later be tagged "left"); existing rows get name /
  // department / designation refreshed — status is never touched here.
  const normCode = (c: unknown) => String(c ?? '').trim().replace(/^0+(?=\d)/, '')
  const sheetEmps = new Map<string, { code: string; name: string; department: string | null; designation: string | null }>()
  for (const d of parsed.days) {
    const k = normCode(d.code)
    if (k && !sheetEmps.has(k)) sheetEmps.set(k, { code: d.code, name: d.name, department: d.department, designation: d.designation })
  }
  const existing = await db.attendanceEmployee.findMany({ select: { id: true, code: true, status: true, name: true, department: true, designation: true } })
  const byCode = new Map<string, any>()
  for (const e of existing) {
    const k = normCode(e.code)
    if (!k) continue
    const cur = byCode.get(k)
    if (!cur || (cur.status !== 'active' && e.status === 'active')) byCode.set(k, e)
  }
  const newEmployees: { code: string; name: string; department: string | null }[] = []
  const updates: { id: number; data: any }[] = []
  for (const [k, se] of sheetEmps) {
    const e = byCode.get(k)
    if (!e) { newEmployees.push({ code: se.code, name: se.name, department: se.department }); continue }
    if (e.name !== se.name || e.department !== se.department || e.designation !== se.designation) {
      updates.push({ id: e.id, data: { name: se.name, department: se.department, designation: se.designation } })
    }
  }

  const upload = await db.$transaction(async (tx: any) => {
    const up = await tx.attendanceUpload.create({
      data: {
        fileName: file.name,
        fromDate: parsed.fromDate, toDate: parsed.toDate,
        employeeCount: parsed.employees, dayCount: dates.length,
        problemCount, skippedRows: parsed.skipped.length,
        newEmployees: newEmployees.length,
        uploadedBy: (session.user as any)?.email ?? null,
      },
    })
    if (newEmployees.length) {
      await tx.attendanceEmployee.createMany({
        data: newEmployees.map(n => ({ petpoojaEmpId: null, code: n.code, name: n.name, department: n.department, designation: sheetEmps.get(normCode(n.code))?.designation ?? null, status: 'active' })),
      })
    }
    for (const u of updates) await tx.attendanceEmployee.update({ where: { id: u.id }, data: u.data })
    await tx.attendancePunchDay.deleteMany({ where: { date: { in: dates } } })
    const rows = parsed.days.map(d => ({
      uploadId: up.id, date: d.date, code: d.code, name: d.name,
      department: d.department, designation: d.designation,
      punches: d.times, problem: d.problem,
    }))
    for (let i = 0; i < rows.length; i += 1000) {
      await tx.attendancePunchDay.createMany({ data: rows.slice(i, i + 1000) })
    }
    return up
  }, { timeout: 60_000 })

  return NextResponse.json({
    ok: true,
    uploadId: upload.id,
    fileName: file.name,
    fromDate: parsed.fromDate, toDate: parsed.toDate,
    employees: parsed.employees,
    days: parsed.days.length,
    dates,
    problems: Object.entries(parsed.problems).map(([date, n]) => ({ date, n })).sort((a, b) => a.date.localeCompare(b.date)),
    skipped: parsed.skipped,
    newEmployees,
    updatedEmployees: updates.length,
  })
}

/** GET /api/attendance/upload — latest upload + the dates currently loaded. */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = prisma as any
  const [upload, perDate, perDateProblems] = await Promise.all([
    db.attendanceUpload.findFirst({ orderBy: { id: 'desc' } }),
    db.attendancePunchDay.groupBy({ by: ['date'], _count: { _all: true }, orderBy: { date: 'asc' } }),
    db.attendancePunchDay.groupBy({ by: ['date'], where: { problem: true }, _count: { _all: true } }),
  ])
  const problems = new Map<string, number>(perDateProblems.map((p: any) => [p.date, p._count._all]))
  return NextResponse.json({
    upload,
    dates: perDate.map((d: any) => ({ date: d.date, rows: d._count._all, problems: problems.get(d.date) ?? 0 })),
  })
}
