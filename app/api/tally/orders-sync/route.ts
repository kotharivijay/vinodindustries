import { NextRequest } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readGoogleSheet, VI_ORDER_SHEET_ID, ORDER_SHEETS } from '@/lib/sheets.vi'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: any) { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) }
      const db = viPrisma as any
      let totalSaved = 0

      for (let fi = 0; fi < ORDER_SHEETS.length; fi++) {
        const { name, firmCode } = ORDER_SHEETS[fi]
        const fetchStart = Date.now()
        send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `Reading ${name}...` })

        let rows: string[][]
        try {
          rows = await readGoogleSheet(VI_ORDER_SHEET_ID, `'${name}'!A4:N`)
        } catch {
          send({ type: 'progress', firm: firmCode, stage: 'error', message: 'Failed to read sheet' })
          continue
        }

        send({ type: 'progress', firm: firmCode, stage: 'parsing', message: `Parsing ${rows.length} rows...` })

        const orders: any[] = []
        const now = new Date()
        for (const r of rows) {
          const partyName = (r[4] || '').trim()
          const orderNo = (r[2] || '').trim()
          if (!partyName && !orderNo) continue

          const balance = parseFloat((r[9] || '0').replace(/,/g, '')) || 0
          orders.push({
            firmCode,
            date: (r[1] || '').trim(),
            orderNo,
            partyOrderNo: (r[3] || '').trim(),
            partyName,
            itemName: (r[5] || '').trim(),
            orderQty: parseFloat((r[6] || '0').replace(/,/g, '')) || 0,
            dispatchMtr: parseFloat((r[7] || '0').replace(/,/g, '')) || 0,
            desDate: (r[8] || '').trim(),
            balance,
            rate: parseFloat((r[10] || '0').replace(/,/g, '')) || 0,
            discount: (r[11] || '').trim(),
            agentName: (r[12] || '').trim(),
            remark: (r[13] || '').trim(),
            status: balance === 0 ? 'Closed' : 'Pending',
            lastSynced: now,
          })
        }

        send({ type: 'progress', firm: firmCode, stage: 'saving', message: `Saving ${orders.length} orders...`, total: orders.length, progress: 0 })

        try { await db.salesOrder.deleteMany({ where: { firmCode } }) } catch {}

        const BATCH = 500
        let saved = 0
        for (let b = 0; b < orders.length; b += BATCH) {
          const batch = orders.slice(b, b + BATCH)
          try {
            const r = await db.salesOrder.createMany({ data: batch, skipDuplicates: true })
            saved += r.count
          } catch {}
          send({ type: 'progress', firm: firmCode, stage: 'saving', message: `Saving...`, total: orders.length, progress: Math.min(b + BATCH, orders.length) })
        }

        totalSaved += saved
        const totalTime = ((Date.now() - fetchStart) / 1000).toFixed(1)
        send({ type: 'progress', firm: firmCode, stage: 'done', message: `${saved} orders synced (${totalTime}s)`, saved })
      }

      send({ type: 'complete', totalSaved })
      controller.close()
    }
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}
