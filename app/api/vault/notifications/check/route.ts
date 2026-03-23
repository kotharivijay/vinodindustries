import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Called by Vercel Cron daily — creates notifications for expiring docs
export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = prisma as any
  const now = new Date()
  const sixtyDaysLater = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  try {
    // Find documents with expiry in next 60 days
    const expiringDocs = await db.vaultDocument.findMany({
      where: {
        expiryDate: { not: null, lte: sixtyDaysLater },
      },
      include: { entity: true },
    })

    if (expiringDocs.length === 0) return NextResponse.json({ checked: 0, created: 0 })

    // Get all approved user emails
    const approvedEmails = (process.env.APPROVED_EMAILS || '').split(',').map((e: string) => e.trim()).filter(Boolean)

    let created = 0

    for (const doc of expiringDocs) {
      for (const email of approvedEmails) {
        // Only create if not already existing
        const existing = await db.vaultNotification.findUnique({
          where: { documentId_userEmail: { documentId: doc.id, userEmail: email } },
        })

        if (!existing) {
          // Create new notification — encrypted names not available in cron context
          await db.vaultNotification.create({
            data: {
              documentId: doc.id,
              userEmail: email,
              entityName: `Entity #${doc.entityId}`,
              entityType: doc.entity.type,
              docName: `Document #${doc.id}`,
              expiryDate: doc.expiryDate,
            },
          })
          created++
        }
      }
    }

    return NextResponse.json({ checked: expiringDocs.length, created })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
