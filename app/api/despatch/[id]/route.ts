import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const db = prisma as any
  let entry
  try {
    entry = await db.despatchEntry.findUnique({
      where: { id: parseInt(id) },
      include: { party: true, quality: true, transport: true, changeLogs: { orderBy: { createdAt: 'desc' } } },
    })
  } catch {
    // Fallback without changeLogs if table doesn't exist
    const raw = await prisma.despatchEntry.findUnique({
      where: { id: parseInt(id) },
      include: { party: true, quality: true, transport: true },
    })
    entry = raw ? { ...raw, changeLogs: [] } : null
  }
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entry)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const entryId = parseInt(id)
  const data = await req.json()
  const newThan = parseInt(data.than)
  const rate = data.rate ? parseFloat(data.rate) : null
  const pTotal = rate && newThan ? parseFloat((newThan * rate).toFixed(2)) : null
  const newLotNo = data.lotNo
  const newRate = rate
  const newBillNo = data.billNo || null

  // Fetch existing entry for change tracking
  const existing = await prisma.despatchEntry.findUnique({ where: { id: entryId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const db = prisma as any
  const entry = await db.despatchEntry.update({
    where: { id: entryId },
    data: {
      date: new Date(data.date),
      challanNo: parseInt(data.challanNo),
      partyId: parseInt(data.partyId),
      qualityId: parseInt(data.qualityId),
      grayInwDate: data.grayInwDate ? new Date(data.grayInwDate) : null,
      lotNo: newLotNo,
      jobDelivery: data.jobDelivery || null,
      than: newThan,
      billNo: newBillNo,
      rate: newRate,
      pTotal,
      lrNo: data.lrNo || null,
      transportId: data.transportId ? parseInt(data.transportId) : null,
      bale: data.bale ? parseInt(data.bale) : null,
      narration: data.narration || null,
    },
    include: { party: true, quality: true, transport: true },
  })

  // Track changes for: than, lotNo, rate, billNo
  const changes: { field: string; oldValue: string; newValue: string }[] = []
  if (existing.than !== newThan) changes.push({ field: 'than', oldValue: String(existing.than), newValue: String(newThan) })
  if (existing.lotNo !== newLotNo) changes.push({ field: 'lotNo', oldValue: existing.lotNo, newValue: newLotNo })
  if ((existing.rate ?? null) !== newRate) changes.push({ field: 'rate', oldValue: String(existing.rate ?? ''), newValue: String(newRate ?? '') })
  if ((existing.billNo ?? null) !== newBillNo) changes.push({ field: 'billNo', oldValue: existing.billNo ?? '', newValue: newBillNo ?? '' })

  if (changes.length > 0) {
    try {
      // Log changes
      await db.despatchChangeLog.createMany({
        data: changes.map(c => ({ entryId, ...c, changedBy: session.user?.email || 'unknown' }))
      })

      // Notify all approved users
      const approvedEmails = (process.env.APPROVED_EMAILS || '').split(',').map((e: string) => e.trim()).filter(Boolean)
      for (const email of approvedEmails) {
        for (const c of changes) {
          await db.despatchNotification.create({
            data: {
              entryId,
              challanNo: existing.challanNo,
              lotNo: newLotNo,
              message: `${c.field}: ${c.oldValue} \u2192 ${c.newValue}`,
              userEmail: email,
            }
          })
        }
      }
    } catch {
      // Silently fail if new models not yet migrated
    }
  }

  return NextResponse.json(entry)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await prisma.despatchEntry.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
