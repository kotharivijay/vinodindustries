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
  if (typeof body.processName === 'string') data.processName = body.processName.trim()
  if ('quality' in body) data.quality = body.quality?.trim() || null
  if (body.rate !== undefined) data.rate = Number(body.rate)
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder)
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  const t = await prisma.contractorJobTemplate.update({ where: { id }, data })
  return Response.json(t)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  // Hard delete — templates are template-only metadata; doesn't touch any
  // already-created ContractorProcessJob rows for past months.
  await prisma.contractorJobTemplate.delete({ where: { id } })
  return Response.json({ ok: true })
}
