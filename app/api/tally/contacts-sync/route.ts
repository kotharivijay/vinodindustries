import { NextRequest } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readGoogleSheet, VI_ORDER_SHEET_ID, CONTACT_SHEETS, parseMobile } from '@/lib/sheets.vi'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: any) { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) }
      const db = viPrisma as any
      let totalSaved = 0

      for (const sheet of CONTACT_SHEETS) {
        const fetchStart = Date.now()
        send({ type: 'progress', firm: sheet.firmCode, stage: 'fetching', message: `Reading ${sheet.name}...` })

        let rows: string[][]
        try {
          rows = await readGoogleSheet(VI_ORDER_SHEET_ID, `'${sheet.name}'!A${sheet.dataRow}:Q`)
        } catch {
          send({ type: 'progress', firm: sheet.firmCode, stage: 'error', message: 'Failed to read sheet' })
          continue
        }

        send({ type: 'progress', firm: sheet.firmCode, stage: 'parsing', message: `Parsing ${rows.length} rows...` })

        // Group by party name → aggregate mobiles
        const partyMap: Record<string, { mobiles: string[]; contactPersons: string[]; agent: string; tag: string }> = {}
        for (const r of rows) {
          const name = (r[0] || '').trim()
          if (!name) continue
          const mobile = parseMobile(r[1] || '')
          const contactPerson = (r[2] || '').trim()
          const agent = (r[3] || '').trim()
          const tag = (r[15] || '').trim().toLowerCase() || (name.includes('(Agent)') ? 'agent' : 'customer')

          const key = name.toLowerCase().replace(/\s+/g, ' ')
          if (!partyMap[key]) {
            partyMap[key] = { mobiles: [], contactPersons: [], agent, tag }
          }
          if (mobile && !partyMap[key].mobiles.includes(mobile)) partyMap[key].mobiles.push(mobile)
          if (contactPerson && !partyMap[key].contactPersons.includes(contactPerson)) partyMap[key].contactPersons.push(contactPerson)
          if (agent && !partyMap[key].agent) partyMap[key].agent = agent
        }

        // Merge with TallyLedger for address/GST
        const ledgers = await db.tallyLedger.findMany({
          where: { firmCode: sheet.firmCode },
          select: { name: true, address: true, state: true, gstNo: true },
        })
        const ledgerMap: Record<string, any> = {}
        for (const l of ledgers) {
          ledgerMap[l.name.toLowerCase().replace(/\s+/g, ' ')] = l
        }

        const contacts: any[] = []
        const now = new Date()
        const seen = new Set<string>()

        for (const [key, val] of Object.entries(partyMap)) {
          // Use original name from first occurrence
          const origRow = rows.find(r => (r[0] || '').trim().toLowerCase().replace(/\s+/g, ' ') === key)
          const name = (origRow?.[0] || '').trim()
          if (!name) continue

          const ukey = `${sheet.firmCode}|${name}`
          if (seen.has(ukey)) continue
          seen.add(ukey)

          const ledger = ledgerMap[key]
          contacts.push({
            firmCode: sheet.firmCode,
            name,
            mobile1: val.mobiles[0] || null,
            mobile2: val.mobiles[1] || null,
            mobile3: val.mobiles[2] || null,
            contactPerson: val.contactPersons.join(', ') || null,
            tag: val.tag || 'customer',
            agentName: val.agent || null,
            address: ledger?.address || null,
            state: ledger?.state || null,
            gstNo: ledger?.gstNo || null,
            source: 'sheet',
            lastSynced: now,
          })
        }

        send({ type: 'progress', firm: sheet.firmCode, stage: 'saving', message: `Saving ${contacts.length} contacts...`, total: contacts.length, progress: 0 })

        try { await db.contact.deleteMany({ where: { firmCode: sheet.firmCode } }) } catch {}

        const BATCH = 500
        let saved = 0
        for (let b = 0; b < contacts.length; b += BATCH) {
          const batch = contacts.slice(b, b + BATCH)
          try {
            const r = await db.contact.createMany({ data: batch, skipDuplicates: true })
            saved += r.count
          } catch {}
          send({ type: 'progress', firm: sheet.firmCode, stage: 'saving', total: contacts.length, progress: Math.min(b + BATCH, contacts.length), message: 'Saving...' })
        }

        totalSaved += saved
        const totalTime = ((Date.now() - fetchStart) / 1000).toFixed(1)
        send({ type: 'progress', firm: sheet.firmCode, stage: 'done', message: `${saved} contacts synced (${totalTime}s)`, saved })
      }

      send({ type: 'complete', totalSaved })
      controller.close()
    }
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}
