import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Codes-only Register membership import. Paste the official register (or just
// a list of codes); every code that matches an EXISTING staff is flagged
// inRegister = true (the green "Reg" badge) and gets its sheet order (sn).
//
// It does NOT touch salary, name, department, wages, or create staff — it
// only marks which codes are on the register. Unmatched codes are reported.
//
// The code column is located as the first integer cell >= 1000 (sn is small,
// code is >= 1000), so a leading STATUS and/or sn column is tolerated.
//
// Body: { text: string, replace?: boolean }
//   replace=true first clears inRegister/registerSn on ALL staff, so codes
//   absent from this paste lose their Reg badge. Default false (merge).

type RowResult = { code: string; status: 'marked' | 'not-found'; name?: string }

const isInt = (s: string) => /^\d+$/.test(s)

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { text?: string; replace?: boolean }
  const text = (body.text || '').trim()
  if (!text) return Response.json({ error: 'Empty paste' }, { status: 400 })

  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim())
  let startIdx = 0
  if (/\b(status|code|employee|name|department|salary|perday|sn|amount)\b/i.test(lines[0] || '')) startIdx = 1

  // Parse (code, sn) pairs from the paste.
  const parsed: { code: string; sn: number | null }[] = []
  const bad: string[] = []
  for (let i = startIdx; i < lines.length; i++) {
    const cells = (/\t/.test(lines[i]) ? lines[i].split('\t') : lines[i].split(','))
      .map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
    const codeIdx = cells.findIndex((c) => isInt(c) && Number(c) >= 1000)
    if (codeIdx < 0) { bad.push(lines[i].slice(0, 40)); continue }
    const sn = codeIdx >= 1 && isInt(cells[codeIdx - 1]) ? Number(cells[codeIdx - 1]) : null
    parsed.push({ code: cells[codeIdx], sn })
  }
  if (parsed.length === 0) return Response.json({ error: 'No codes (>=1000) found in paste' }, { status: 400 })

  if (body.replace) {
    await prisma.staff.updateMany({ data: { inRegister: false, registerSn: null } })
  }

  // Match against existing staff only — never create.
  const codes = parsed.map((p) => p.code)
  const existing = await prisma.staff.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, name: true },
  })
  const byCode = new Map(existing.map((s) => [s.code, s]))

  const results: RowResult[] = []
  let marked = 0
  for (const p of parsed) {
    const s = byCode.get(p.code)
    if (!s) { results.push({ code: p.code, status: 'not-found' }); continue }
    await prisma.staff.update({
      where: { id: s.id },
      data: { inRegister: true, registerSn: p.sn ?? undefined },
    })
    results.push({ code: p.code, status: 'marked', name: s.name })
    marked++
  }

  return Response.json({
    marked,
    notFound: results.filter((r) => r.status === 'not-found').length,
    unparsed: bad.length,
    total: parsed.length,
    results,
  })
}
