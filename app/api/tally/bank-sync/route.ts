export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readGoogleSheet, VI_OS_SHEET_ID, BANK_SHEETS } from '@/lib/sheets.vi'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: any) { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) }
      const db = viPrisma as any
      let totalSaved = 0

      // VI and VCF from Google Sheets
      for (const sheet of BANK_SHEETS) {
        const fetchStart = Date.now()
        send({ type: 'progress', firm: sheet.firmCode, stage: 'fetching', message: `Reading ${sheet.name}...` })

        let rows: string[][]
        try {
          rows = await readGoogleSheet(VI_OS_SHEET_ID, `'${sheet.name}'!A2:N`)
        } catch {
          send({ type: 'progress', firm: sheet.firmCode, stage: 'error', message: 'Failed to read sheet' })
          continue
        }

        send({ type: 'progress', firm: sheet.firmCode, stage: 'parsing', message: `Parsing ${rows.length} rows...` })

        const payments: any[] = []
        const now = new Date()
        for (const r of rows) {
          const withdrawal = parseFloat((r[4] || '0').replace(/,/g, '')) || 0
          const deposit = parseFloat((r[5] || '0').replace(/,/g, '')) || 0
          if (withdrawal === 0 && deposit === 0) continue

          payments.push({
            firmCode: sheet.firmCode,
            voucherDate: (r[0] || '').trim(),
            description: (r[1] || '').trim(),
            instNo: (r[2] || '').trim(),
            partyName: (r[7] || '').trim() || null, // col H
            withdrawal,
            deposit,
            narration: (r[11] || '').trim() || null, // col L
            paymentDays: parseInt(r[13] || '0') || null, // col N
            source: 'sheet',
            lastSynced: now,
          })
        }

        send({ type: 'progress', firm: sheet.firmCode, stage: 'saving', message: `Saving ${payments.length} payments...`, total: payments.length, progress: 0 })

        try { await db.bankPayment.deleteMany({ where: { firmCode: sheet.firmCode } }) } catch {}

        const BATCH = 500
        let saved = 0
        for (let b = 0; b < payments.length; b += BATCH) {
          const batch = payments.slice(b, b + BATCH)
          try {
            const r = await db.bankPayment.createMany({ data: batch, skipDuplicates: true })
            saved += r.count
          } catch {}
          send({ type: 'progress', firm: sheet.firmCode, stage: 'saving', total: payments.length, progress: Math.min(b + BATCH, payments.length), message: 'Saving...' })
        }

        totalSaved += saved
        const totalTime = ((Date.now() - fetchStart) / 1000).toFixed(1)
        send({ type: 'progress', firm: sheet.firmCode, stage: 'done', message: `${saved} payments synced (${totalTime}s)`, saved })
      }

      // VF from TallyReceipt (already in DB)
      send({ type: 'progress', firm: 'VF', stage: 'fetching', message: 'Loading VF from Tally receipts...' })
      try {
        const receipts = await db.tallyReceipt.findMany({
          where: { firmCode: 'VF', vchType: { in: ['Receipt', 'Payment'] } },
          select: { date: true, vchNumber: true, partyName: true, amount: true, vchType: true, narration: true },
        })

        await db.bankPayment.deleteMany({ where: { firmCode: 'VF' } })

        const vfPayments = receipts.map((r: any) => ({
          firmCode: 'VF',
          voucherDate: r.date ? new Date(r.date).toLocaleDateString('en-GB') : null,
          description: r.narration || null,
          partyName: r.partyName || null,
          withdrawal: r.vchType === 'Payment' ? Math.abs(r.amount || 0) : 0,
          deposit: r.vchType === 'Receipt' ? Math.abs(r.amount || 0) : 0,
          narration: r.narration || null,
          source: 'tally',
          lastSynced: new Date(),
        }))

        if (vfPayments.length > 0) {
          await db.bankPayment.createMany({ data: vfPayments, skipDuplicates: true })
        }
        totalSaved += vfPayments.length
        send({ type: 'progress', firm: 'VF', stage: 'done', message: `${vfPayments.length} payments from Tally (VF)` })
      } catch {
        send({ type: 'progress', firm: 'VF', stage: 'done', message: '0 VF payments (no Tally receipt data)' })
      }

      send({ type: 'complete', totalSaved })
      controller.close()
    }
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}
