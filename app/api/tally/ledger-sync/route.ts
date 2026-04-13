import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 60

const TALLY_COMPANY = 'Kothari Synthetic Industries -( from 2023)'

function decodeXML(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '').replace(/&#10;/g, '').trim()
}

function buildLedgerXML(): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerExport</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${TALLY_COMPANY}</SVCURRENTCOMPANY>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="LedgerExport" ISMODIFY="No">
<TYPE>Ledger</TYPE>
<FETCH>Name,Parent,Address,LedStateName,Pincode,PartyGSTIN,IncomeTaxNumber,LedgerPhone,LedgerMobile,ClosingBalance</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`
}

function parseLedgers(xml: string) {
  const ledgers: any[] = []
  const blocks = xml.match(/<LEDGER NAME="[^"]*"[\s\S]*?<\/LEDGER>/g) || []
  for (const block of blocks) {
    const rawName = block.match(/LEDGER NAME="([^"]*)"/)?.[1]?.trim() || ''
    if (!rawName) continue
    const name = decodeXML(rawName)
    const parent = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/)?.[1] || null
    const addrLines = block.match(/<ADDRESS[^>]*>([^<]*)<\/ADDRESS>/g)?.map(a => a.replace(/<[^>]+>/g, '')) || []
    const address = addrLines.length ? decodeXML(addrLines.join(', ')) : null
    const state = block.match(/<LEDSTATENAME[^>]*>([^<]*)<\/LEDSTATENAME>/)?.[1] || null
    const gstNo = block.match(/<PARTYGSTIN[^>]*>([^<]*)<\/PARTYGSTIN>/)?.[1] || null
    const panNo = block.match(/<INCOMETAXNUMBER[^>]*>([^<]*)<\/INCOMETAXNUMBER>/)?.[1] || null
    const mobile = block.match(/<LEDGERMOBILE[^>]*>([^<]*)<\/LEDGERMOBILE>/)?.[1] || null
    const phone = block.match(/<LEDGERPHONE[^>]*>([^<]*)<\/LEDGERPHONE>/)?.[1] || null
    const mobileNos = [mobile, phone].filter(Boolean).map(m => decodeXML(m!)).join(', ') || null
    const closingBal = block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/)?.[1] || null
    const closingBalance = closingBal ? parseFloat(closingBal.replace(/,/g, '')) || null : null

    ledgers.push({ name, parent: parent ? decodeXML(parent) : null, address, state: state ? decodeXML(state) : null, gstNo: gstNo ? decodeXML(gstNo) : null, panNo: panNo ? decodeXML(panNo) : null, mobileNos, closingBalance })
  }
  return ledgers
}

async function doSync(): Promise<{ count: number; duration: number; error?: string }> {
  const start = Date.now()
  const db = prisma as any

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) throw new Error('TALLY_TUNNEL_URL not configured')

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = process.env.TALLY_API_SECRET
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  const res = await fetch(tunnelUrl, { method: 'POST', headers, body: buildLedgerXML(), signal: AbortSignal.timeout(50000) })
  if (!res.ok) throw new Error(`Tally HTTP ${res.status} ${res.statusText}`)

  const xml = await res.text()
  if (!xml.includes('<LEDGER')) throw new Error('No ledger data in response')

  const ledgers = parseLedgers(xml)
  if (ledgers.length === 0) throw new Error('Parsed 0 ledgers')

  // Upsert in batches
  let synced = 0
  for (const l of ledgers) {
    try {
      await db.tallyLedger.upsert({
        where: { firmCode_name: { firmCode: 'KSI', name: l.name } },
        create: { firmCode: 'KSI', name: l.name, parent: l.parent, address: l.address, gstNo: l.gstNo, panNo: l.panNo, mobileNos: l.mobileNos, state: l.state, closingBalance: l.closingBalance, openingBalance: null, lastSynced: new Date() },
        update: { parent: l.parent, address: l.address, gstNo: l.gstNo, panNo: l.panNo, mobileNos: l.mobileNos, state: l.state, closingBalance: l.closingBalance, lastSynced: new Date() },
      })
      synced++
    } catch {}
  }

  const duration = (Date.now() - start) / 1000
  return { count: synced, duration }
}

// GET — SSE manual sync with progress
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: any) { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) }
      const db = prisma as any

      send({ type: 'progress', message: 'Fetching ledgers from Tally KSI...' })

      try {
        const result = await doSync()
        send({ type: 'progress', message: `Synced ${result.count} ledgers in ${result.duration.toFixed(1)}s` })

        // Log success
        await db.tallySyncLog.create({ data: { type: 'ledger', company: 'KSI', status: 'success', count: result.count, duration: result.duration } })

        send({ type: 'complete', message: `✅ Sync complete — ${result.count} ledgers in ${result.duration.toFixed(1)}s`, count: result.count })
      } catch (err: any) {
        const msg = err?.message || 'Unknown error'
        send({ type: 'error', message: `❌ Sync failed: ${msg}` })

        // Log failure
        await db.tallySyncLog.create({ data: { type: 'ledger', company: 'KSI', status: 'failed', error: msg } })
      }

      controller.close()
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}

// POST — used by cron job (non-SSE)
export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const db = prisma as any

  try {
    const result = await doSync()
    await db.tallySyncLog.create({ data: { type: 'ledger', company: 'KSI', status: 'success', count: result.count, duration: result.duration } })
    return Response.json({ ok: true, count: result.count, duration: result.duration })
  } catch (err: any) {
    const msg = err?.message || 'Unknown error'
    await db.tallySyncLog.create({ data: { type: 'ledger', company: 'KSI', status: 'failed', error: msg } })

    // WhatsApp notification on failure
    try {
      const phone = '919414130140'
      const text = encodeURIComponent(`❌ KSI Tally Ledger Sync FAILED\n${new Date().toLocaleString('en-IN')}\nError: ${msg}`)
      await fetch(`https://wa.me/${phone}?text=${text}`)
    } catch {}

    return Response.json({ error: msg }, { status: 500 })
  }
}
