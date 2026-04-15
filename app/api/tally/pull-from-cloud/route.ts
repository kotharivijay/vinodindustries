export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { viPrisma } from '@/lib/prisma'

// Pull KSI data from cloud Neon DB → local PostgreSQL
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const localUrl = process.env.LOCAL_DATABASE_URL
  if (!localUrl) {
    return Response.json({ error: 'LOCAL_DATABASE_URL not configured' }, { status: 500 })
  }

  const tables = req.nextUrl.searchParams.get('tables')?.split(',') || ['ledgers', 'outstanding', 'sales', 'receipts']
  const firmCode = req.nextUrl.searchParams.get('firm') || 'KSI'

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const cloud = viPrisma as any
      let local: PrismaClient | null = null

      try {
        // Connect to local PostgreSQL
        send({ message: 'Connecting to local database...' })
        local = new PrismaClient({
          datasources: { db: { url: localUrl } },
          log: ['error'],
        })
        await (local as any).$connect()
        send({ message: 'Connected to local PostgreSQL' })

        const localDb = local as any

        // Pull TallyLedger
        if (tables.includes('ledgers')) {
          send({ message: `Fetching ${firmCode} ledgers from cloud...` })
          const ledgers = await cloud.tallyLedger.findMany({ where: { firmCode } })
          send({ message: `Found ${ledgers.length} ledgers. Writing to local DB...` })

          if (ledgers.length > 0) {
            await localDb.tallyLedger.deleteMany({ where: { firmCode } })
            const BATCH = 500
            let saved = 0
            for (let i = 0; i < ledgers.length; i += BATCH) {
              const batch = ledgers.slice(i, i + BATCH).map((l: any) => {
                const { id, ...rest } = l
                return rest
              })
              try {
                const r = await localDb.tallyLedger.createMany({ data: batch, skipDuplicates: true })
                saved += r.count
              } catch {}
            }
            send({ message: `Ledgers: ${saved} saved locally` })
          } else {
            send({ message: 'Ledgers: no data in cloud' })
          }
        }

        // Pull TallyOutstanding
        if (tables.includes('outstanding')) {
          send({ message: `Fetching ${firmCode} outstanding from cloud...` })
          const outstanding = await cloud.tallyOutstanding.findMany({ where: { firmCode } })
          send({ message: `Found ${outstanding.length} outstanding records. Writing to local DB...` })

          if (outstanding.length > 0) {
            await localDb.tallyOutstanding.deleteMany({ where: { firmCode } })
            const BATCH = 500
            let saved = 0
            for (let i = 0; i < outstanding.length; i += BATCH) {
              const batch = outstanding.slice(i, i + BATCH).map((o: any) => {
                const { id, ...rest } = o
                return rest
              })
              try {
                const r = await localDb.tallyOutstanding.createMany({ data: batch, skipDuplicates: true })
                saved += r.count
              } catch {}
            }
            send({ message: `Outstanding: ${saved} saved locally` })
          } else {
            send({ message: 'Outstanding: no data in cloud' })
          }
        }

        // Pull TallySales
        if (tables.includes('sales')) {
          send({ message: `Fetching ${firmCode} sales from cloud...` })
          const sales = await cloud.tallySales.findMany({ where: { firmCode } })
          send({ message: `Found ${sales.length} sales records. Writing to local DB...` })

          if (sales.length > 0) {
            await localDb.tallySales.deleteMany({ where: { firmCode } })
            const BATCH = 500
            let saved = 0
            for (let i = 0; i < sales.length; i += BATCH) {
              const batch = sales.slice(i, i + BATCH).map((s: any) => {
                const { id, ...rest } = s
                return rest
              })
              try {
                const r = await localDb.tallySales.createMany({ data: batch, skipDuplicates: true })
                saved += r.count
              } catch {}
            }
            send({ message: `Sales: ${saved} saved locally` })
          } else {
            send({ message: 'Sales: no data in cloud' })
          }
        }

        // Pull TallyReceipt
        if (tables.includes('receipts')) {
          send({ message: `Fetching ${firmCode} receipts from cloud...` })
          const receipts = await cloud.tallyReceipt.findMany({ where: { firmCode } })
          send({ message: `Found ${receipts.length} receipt records. Writing to local DB...` })

          if (receipts.length > 0) {
            await localDb.tallyReceipt.deleteMany({ where: { firmCode } })
            const BATCH = 500
            let saved = 0
            for (let i = 0; i < receipts.length; i += BATCH) {
              const batch = receipts.slice(i, i + BATCH).map((r: any) => {
                const { id, ...rest } = r
                return rest
              })
              try {
                const r = await localDb.tallyReceipt.createMany({ data: batch, skipDuplicates: true })
                saved += r.count
              } catch {}
            }
            send({ message: `Receipts: ${saved} saved locally` })
          } else {
            send({ message: 'Receipts: no data in cloud' })
          }
        }

        send({ message: 'Pull complete', done: true })
      } catch (e: any) {
        send({ message: `Error: ${e.message}`, error: true })
      } finally {
        if (local) await (local as any).$disconnect()
      }

      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
