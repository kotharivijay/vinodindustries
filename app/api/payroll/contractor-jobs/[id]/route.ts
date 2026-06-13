import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recomputeContractorBalance } from '@/lib/payrollBalance'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const existing = await prisma.contractorProcessJob.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.processName === 'string') data.processName = body.processName.trim()
  if ('quality' in body) data.quality = body.quality?.trim() || null
  if ('notes' in body) data.notes = body.notes?.trim() || null
  const rate = body.rate !== undefined ? Number(body.rate) : existing.rate
  const quantity = body.quantity !== undefined ? Number(body.quantity) : existing.quantity
  if (body.rate !== undefined || body.quantity !== undefined) {
    data.rate = rate
    data.quantity = quantity
    data.total = rate * quantity
  }

  const updated = await prisma.contractorProcessJob.update({ where: { id }, data })
  await recomputeContractorBalance(existing.contractorId, existing.monthKey)
  return Response.json(updated)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.contractorProcessJob.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

  await prisma.contractorProcessJob.delete({ where: { id } })
  await recomputeContractorBalance(existing.contractorId, existing.monthKey)
  return Response.json({ ok: true })
}
