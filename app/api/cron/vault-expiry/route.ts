import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  // Verify Vercel Cron secret
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = prisma as any
  const now = new Date()

  try {
    const notifications = await db.vaultNotification.findMany({
      where: { dismissed: false },
    })

    if (notifications.length === 0) return NextResponse.json({ sent: 0 })

    // Group by email
    const byEmail = new Map<string, any[]>()
    for (const n of notifications) {
      const daysLeft = Math.ceil((new Date(n.expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      if (daysLeft > 60) continue // skip if more than 60 days

      const arr = byEmail.get(n.userEmail) || []
      arr.push({ ...n, daysLeft })
      byEmail.set(n.userEmail, arr)
    }

    // Send emails
    let sent = 0
    for (const [email, items] of byEmail) {
      // Check if already emailed today
      const lastEmailed = items[0].lastEmailed
      if (lastEmailed && new Date(lastEmailed).toDateString() === now.toDateString()) continue

      const body = items.map((i: any) =>
        `- ${i.docName} (${i.entityName}, ${i.entityType}) — ${i.daysLeft <= 0 ? 'EXPIRED' : `${i.daysLeft} days left`}${i.daysLeft <= 15 ? ' ⚠ URGENT' : ''}`
      ).join('\n')

      // Try sending email via Resend if configured
      if (process.env.RESEND_API_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Vault Alerts <alerts@vinodindustries.vercel.app>',
              to: email,
              subject: `⚠ ${items.length} Document${items.length > 1 ? 's' : ''} Expiring Soon`,
              text: `Documents requiring attention:\n\n${body}\n\nManage: https://vinodindustries.vercel.app/vault`,
            }),
          })
        } catch {}
      }

      // Update lastEmailed
      for (const i of items) {
        await db.vaultNotification.update({
          where: { id: i.id },
          data: { lastEmailed: now },
        })
      }
      sent++
    }

    return NextResponse.json({ sent, notifications: notifications.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
