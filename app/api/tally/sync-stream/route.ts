import { NextRequest } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const FIRM_TALLY: Record<string, string> = {
  VI: 'Vinod Industries - (from 1-Apr-25)',
  VCF: 'Vimal Cotton Fabrics',
  VF: 'Vijay Fabrics - (from 1-Apr-2019)',
  KSI: 'Kothari Synthetic Industries -( from 2023)',
}

function buildLedgerXML(tallyCompany: string): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerExport</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${tallyCompany}</SVCURRENTCOMPANY>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="LedgerExport" ISMODIFY="No">
<TYPE>Ledger</TYPE>
<FETCH>Name,Parent,Address,LedStateName,GSTRegistrationType,PartyGSTIN,IncomeTaxNumber,LedgerPhone,LedgerMobile</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`
}

function parseXMLLedgers(xml: string) {
  const ledgers: any[] = []
  const blocks = xml.match(/<LEDGER NAME="[^"]*"[\s\S]*?<\/LEDGER>/g) || []
  for (const block of blocks) {
    const name = block.match(/LEDGER NAME="([^"]*)"/)?.[1]?.trim() || ''
    if (!name) continue
    const parent = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/)?.[1] || null
    const addrLines = block.match(/<ADDRESS TYPE="String">([^<]*)<\/ADDRESS>/g)?.map(a => a.replace(/<[^>]+>/g, '')) || []
    const address = addrLines.length ? addrLines.join(', ') : null
    const state = block.match(/<LEDSTATENAME[^>]*>([^<]*)<\/LEDSTATENAME>/)?.[1] || null
    const gstNo = block.match(/<PARTYGSTIN[^>]*>([^<]*)<\/PARTYGSTIN>/)?.[1] || null
    const panNo = block.match(/<INCOMETAXNUMBER[^>]*>([^<]*)<\/INCOMETAXNUMBER>/)?.[1] || null
    const mobile = block.match(/<LEDGERMOBILE[^>]*>([^<]*)<\/LEDGERMOBILE>/)?.[1] || null
    const phone = block.match(/<LEDGERPHONE[^>]*>([^<]*)<\/LEDGERPHONE>/)?.[1] || null
    const mobileNos = [mobile, phone].filter(Boolean).join(', ') || null
    ledgers.push({ name, parent, address, gstNo, panNo, mobileNos, state })
  }
  return ledgers
}

// GET — Server-Sent Events stream for sync progress
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const firmParam = req.nextUrl.searchParams.get('firm') || ''
  const firmsToSync = firmParam && FIRM_TALLY[firmParam] ? [firmParam] : Object.keys(FIRM_TALLY)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const tunnelUrl = process.env.TALLY_TUNNEL_URL
      if (!tunnelUrl) {
        send({ type: 'error', message: 'Tally tunnel URL not configured' })
        controller.close()
        return
      }

      const db = viPrisma as any
      let totalSaved = 0

      for (let fi = 0; fi < firmsToSync.length; fi++) {
        const firmCode = firmsToSync[fi]
        const tallyName = FIRM_TALLY[firmCode]

        // Stage 1: Fetching
        send({ type: 'progress', firm: firmCode, stage: 'fetching', message: 'Fetching XML from Tally...' })

        let xml: string
        const fetchStart = Date.now()
        const apiSecret = process.env.TALLY_API_SECRET || ''
        try {
          const res = await fetch(tunnelUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml', 'X-Tally-Key': apiSecret },
            body: buildLedgerXML(tallyName),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
          xml = await res.text()
          if (!xml.includes('<LEDGER')) throw new Error(`No ledger data in response — check company name "${tallyName}" in Tally. Response: ${xml.slice(0, 300)}`)
        } catch (e: any) {
          send({ type: 'progress', firm: firmCode, stage: 'error', message: `✗ ${e.message}` })
          continue
        }

        const fetchTime = ((Date.now() - fetchStart) / 1000).toFixed(1)

        // Stage 2: Parsing
        send({ type: 'progress', firm: firmCode, stage: 'parsing', message: `Fetched in ${fetchTime}s. Parsing...` })
        const ledgers = parseXMLLedgers(xml)

        // Free XML from memory immediately
        // @ts-ignore
        xml = ''

        send({ type: 'progress', firm: firmCode, stage: 'saving', message: `Parsed ${ledgers.length} ledgers. Saving...`, total: ledgers.length, progress: 0 })

        // Stage 3: Delete old + bulk insert in batches
        try {
          await db.tallyLedger.deleteMany({ where: { firmCode } })
        } catch {}

        const BATCH_SIZE = 2000
        const now = new Date()
        let saved = 0

        for (let b = 0; b < ledgers.length; b += BATCH_SIZE) {
          const batch = ledgers.slice(b, b + BATCH_SIZE)

          // Deduplicate within batch
          const seen = new Set<string>()
          const data = batch.filter(l => {
            const key = l.name.toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
          }).map(l => ({
            firmCode,
            name: l.name,
            parent: l.parent,
            address: l.address,
            gstNo: l.gstNo,
            panNo: l.panNo,
            mobileNos: l.mobileNos,
            state: l.state,
            lastSynced: now,
          }))

          try {
            const result = await db.tallyLedger.createMany({ data, skipDuplicates: true })
            saved += result.count
          } catch {
            // Fallback: try smaller batches
            for (let i = 0; i < data.length; i += 100) {
              try {
                const r = await db.tallyLedger.createMany({ data: data.slice(i, i + 100), skipDuplicates: true })
                saved += r.count
              } catch {}
            }
          }

          const progress = Math.min(b + BATCH_SIZE, ledgers.length)
          send({ type: 'progress', firm: firmCode, stage: 'saving', message: `Saving... ${progress} of ${ledgers.length}`, total: ledgers.length, progress })
        }

        totalSaved += saved
        const totalTime = ((Date.now() - fetchStart) / 1000).toFixed(1)
        send({ type: 'progress', firm: firmCode, stage: 'done', message: `${saved} ledgers synced (${totalTime}s)`, saved })
      }

      send({ type: 'complete', totalSaved })
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
