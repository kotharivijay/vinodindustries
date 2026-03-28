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

// Generate weekly date ranges from April 2025 to today
function getWeeklyRanges(): { from: string; to: string; label: string }[] {
  const now = new Date()
  now.setHours(23, 59, 59)
  const ranges: { from: string; to: string; label: string }[] = []
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
  const lbl = (d: Date) => `${d.getDate()} ${months[d.getMonth()]}`

  let start = new Date(2025, 3, 1) // 1 April 2025
  while (start <= now) {
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const actualEnd = end > now ? now : end

    ranges.push({
      from: fmt(start),
      to: fmt(actualEnd),
      label: `${lbl(start)}-${lbl(actualEnd)} ${actualEnd.getFullYear()}`,
    })

    start = new Date(actualEnd)
    start.setDate(start.getDate() + 1)
  }
  return ranges
}

function buildDayBookXML(tallyCompany: string, fromDate: string, toDate: string, vchType: string): string {
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Day Book</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${tallyCompany}</SVCURRENTCOMPANY>
      <SVFROMDATE>${fromDate}</SVFROMDATE>
      <SVTODATE>${toDate}</SVTODATE>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="Day Book" ISMODIFY="No">
        <TYPE>Voucher</TYPE>
        <CHILDOF>${vchType}</CHILDOF>
        <FETCH>Date,VoucherNumber,PartyLedgerName,Amount,VoucherTypeName,Narration</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`
}

function decodeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

interface ParsedReceipt {
  date: Date | null
  vchNumber: string
  partyName: string
  amount: number
  vchType: string
  narration: string | null
}

function parseReceiptXML(xml: string, defaultVchType: string): ParsedReceipt[] {
  const results: ParsedReceipt[] = []

  // Match VOUCHER blocks
  const voucherBlocks = xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []

  for (const block of voucherBlocks) {
    const dateStr = block.match(/<DATE[^>]*>([^<]*)<\/DATE>/)?.[1] || ''
    const vchNumber = block.match(/<VOUCHERNUMBER[^>]*>([^<]*)<\/VOUCHERNUMBER>/)?.[1] || ''
    const partyName = block.match(/<PARTYLEDGERNAME[^>]*>([^<]*)<\/PARTYLEDGERNAME>/)?.[1] || ''
    const amountStr = block.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/)?.[1] || '0'
    const vchTypeStr = block.match(/<VOUCHERTYPENAME[^>]*>([^<]*)<\/VOUCHERTYPENAME>/)?.[1] || defaultVchType
    const narration = block.match(/<NARRATION[^>]*>([^<]*)<\/NARRATION>/)?.[1] || null

    let date: Date | null = null
    if (dateStr) {
      // Tally date format: YYYYMMDD or standard
      const cleaned = decodeHtml(dateStr.trim())
      const d = cleaned.length === 8
        ? new Date(`${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`)
        : new Date(cleaned)
      if (!isNaN(d.getTime())) date = d
    }

    const amount = Math.abs(parseFloat(decodeHtml(amountStr).replace(/,/g, '')) || 0)

    if (partyName || amount > 0) {
      results.push({
        date,
        vchNumber: decodeHtml(vchNumber),
        partyName: decodeHtml(partyName),
        amount,
        vchType: decodeHtml(vchTypeStr),
        narration: narration ? decodeHtml(narration) : null,
      })
    }
  }

  return results
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const firmParam = req.nextUrl.searchParams.get('firm') || ''
  const firmsToSync = firmParam && FIRM_TALLY[firmParam] ? [firmParam] : ['VI', 'VCF', 'VF']
  const weeks = getWeeklyRanges()

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
      const tallyHeaders: Record<string, string> = { 'Content-Type': 'text/xml' }
      if (process.env.TALLY_API_SECRET) tallyHeaders['X-Tally-Key'] = process.env.TALLY_API_SECRET
      if (process.env.CF_ACCESS_CLIENT_ID) tallyHeaders['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
      if (process.env.CF_ACCESS_CLIENT_SECRET) tallyHeaders['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

      const db = viPrisma as any
      let totalSaved = 0

      for (const firmCode of firmsToSync) {
        const tallyName = FIRM_TALLY[firmCode]
        let firmTotal = 0

        // Delete existing receipts for fresh sync
        try { await db.tallyReceipt.deleteMany({ where: { firmCode } }) } catch {}

        send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `Fetching receipts/payments for ${firmCode}...`, total: weeks.length, progress: 0 })

        const now = new Date()

        for (let wi = 0; wi < weeks.length; wi++) {
          const w = weeks[wi]

          send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `${firmCode}: ${w.label} (${wi + 1}/${weeks.length})`, total: weeks.length, progress: wi })

          // Fetch both Receipt and Payment vouchers
          for (const vchType of ['Receipt', 'Payment']) {
            try {
              const res = await fetch(tunnelUrl, {
                method: 'POST',
                headers: tallyHeaders,
                body: buildDayBookXML(tallyName, w.from, w.to, vchType),
              })
              if (!res.ok) continue
              const xml = await res.text()
              const receipts = parseReceiptXML(xml, vchType)

              if (receipts.length > 0) {
                const data = receipts.map(r => ({
                  firmCode,
                  date: r.date,
                  vchNumber: r.vchNumber,
                  partyName: r.partyName,
                  amount: r.amount,
                  vchType: r.vchType,
                  narration: r.narration,
                  lastSynced: now,
                }))

                try {
                  const result = await db.tallyReceipt.createMany({ data, skipDuplicates: true })
                  firmTotal += result.count
                } catch {}
              }
            } catch (e: any) {
              send({ type: 'progress', firm: firmCode, stage: 'error', message: `${firmCode} ${vchType}: ${e.message}` })
            }
          }
        }

        totalSaved += firmTotal
        send({ type: 'progress', firm: firmCode, stage: 'done', message: `${firmCode}: ${firmTotal} receipt/payment entries synced` })
      }

      send({ type: 'complete', totalSaved })
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  })
}
