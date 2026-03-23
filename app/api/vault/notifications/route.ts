import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  try {
    const notifications = await db.vaultNotification.findMany({
      where: { userEmail: session.user.email, dismissed: false },
      orderBy: { expiryDate: 'asc' },
    })

    const now = new Date()
    const results = notifications
      .map((n: any) => {
        const daysLeft = Math.ceil((new Date(n.expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        return {
          id: n.id,
          documentId: n.documentId,
          entityName: n.entityName,
          entityType: n.entityType,
          docName: n.docName,
          expiryDate: n.expiryDate,
          daysLeft,
          urgent: daysLeft <= 15,
        }
      })
      .filter((n: any) => n.daysLeft <= 60) // Only show if ≤ 60 days remaining

    return NextResponse.json(results)
  } catch {
    return NextResponse.json([])
  }
}
