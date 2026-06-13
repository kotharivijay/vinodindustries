import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string') data.name = body.name.trim()
  if ('tallyLedgerName' in body) data.tallyLedgerName = body.tallyLedgerName?.trim() || null
  if ('notes' in body) data.notes = body.notes?.trim() || null
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.hiddenInWages === 'boolean') data.hiddenInWages = body.hiddenInWages

  // If renaming, reject case-insensitive collisions with OTHER contractors.
  if (typeof data.name === 'string') {
    const clash = await prisma.contractor.findFirst({
      where: { name: { equals: data.name as string, mode: 'insensitive' }, id: { not: id } },
    })
    if (clash) {
      return Response.json({ error: `Another contractor "${clash.name}" already uses this name (case-insensitive). Rename or merge first.` }, { status: 409 })
    }
  }

  const c = await prisma.contractor.update({ where: { id }, data })
  return Response.json(c)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  // Soft delete — keep history for past wage entries that may reference it.
  await prisma.contractor.update({ where: { id }, data: { isActive: false } })
  return Response.json({ ok: true })
}
