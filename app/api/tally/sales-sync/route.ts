import { NextRequest } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const FIRM_TALLY: Record<string, string> = {
  VI: 'Vinod Industries - (from 1-Apr-25)',
  VCF: 'Vimal Cotton Fabrics',
  VF: 'Vijay Fabrics - (from 1-Apr-2019)',
  KSI: 'Kothari Synthetic Industries',
}

const REPORT_NAME = 'LEARNWELLIVouchersSales'

// Generate weekly date ranges from April 2025 to today
function getWeeklyRanges(): { from: string; to: string; label: string }[] {
  const now = new Date()
  now.setHours(23, 59, 59) // include today
  const ranges: { from: string; to: string; label: string }[] = []
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
  const lbl = (d: Date) => `${d.getDate()} ${months[d.getMonth()]}`

  let start = new Date(2025, 3, 1) // 1 April 2025
  while (start <= now) {
    const end = new Date(start)
    end.setDate(end.getDate() + 6) // 7-day window
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

function buildSalesXML(tallyCompany: string, fromDate: string, toDate: string): string {
  return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>${REPORT_NAME}</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${tallyCompany}</SVCURRENTCOMPANY>
      <SVFROMDATE>${fromDate}</SVFROMDATE>
      <SVTODATE>${toDate}</SVTODATE>
      <SVEXPORTFORMAT>XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`
}

function decodeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function parseQtyUnit(s: string): { value: number; unit: string } {
  const str = decodeHtml(String(s || '')).trim()
  const m = str.match(/([\d,.\s]+)\s*([A-Za-z]+)/)
  if (!m) return { value: 0, unit: '' }
  const numStr = m[1].replace(/,/g, '').replace(/\s/g, '')
  return { value: parseFloat(numStr) || 0, unit: m[2].toUpperCase() }
}

function parseRateUnit(s: string): { value: number; unit: string } {
  const m = String(s || '').match(/([\d,.]+)\/(\w+)/i)
  return m ? { value: parseFloat(m[1].replace(/,/g, '')) || 0, unit: m[2].toUpperCase() } : { value: 0, unit: '' }
}

function parseSalesXML(xml: string): any[] {
  const results: any[] = []
  // Match flat XML tags — same regex as Google Script: /<([^>]+)>([^<]*)<\/\1>/g
  const re = /<([^>\/]+)>([^<]*)<\/\1>/g
  let curVCNo = '', curVCDate = '', curParty = '', curNarr = '', curVchType = ''
  let curItem: Record<string, string> = {}
  let match

  const flushItem = () => {
    if (!curItem.VCITEMN) return
    const { value: qty, unit: qUnit } = parseQtyUnit(curItem.VCITEMQT || '')
    const { value: rate, unit: rUnit } = parseRateUnit(curItem.VCITEMRT || '')
    const taxable = parseFloat(decodeHtml(curItem.VCITEMTX || '').replace(/,/g, '')) || 0
    const amount = taxable || (qty * rate)

    let date: Date | null = null
    if (curVCDate) {
      const d = new Date(decodeHtml(curVCDate))
      if (!isNaN(d.getTime())) date = d
    }

    results.push({
      vchNumber: decodeHtml(curVCNo),
      date,
      partyName: decodeHtml(curParty),
      itemName: decodeHtml(curItem.VCITEMN),
      quantity: qty,
      unit: qUnit || rUnit || null,
      rate,
      amount: Math.abs(amount),
      vchType: decodeHtml(curVchType) || 'Sales',
      narration: curNarr ? decodeHtml(curNarr) : null,
    })
    curItem = {}
  }

  while ((match = re.exec(xml)) !== null) {
    const tag = match[1], val = match[2].trim()

    switch (tag) {
      case 'VOUCHER_VCNO':   if (val) curVCNo = val; break
      case 'VOUCHER_VCDATE': if (val) curVCDate = val; break
      case 'PARTY_NAME':     if (val) curParty = val; break
      case 'VCHNARR':        if (val) curNarr = val; break
      case 'VOUCHER_SNO':    if (val) curVchType = val; break

      case 'VCITEMN':
        // Flush previous item if exists
        if (curItem.VCITEMN) flushItem()
        curItem = { VCITEMN: val || '' }
        break

      case 'VCITEMTXLD':
        // End of item block — flush
        if (curItem) curItem[tag] = val || ''
        if (curItem.VCITEMN) flushItem()
        break

      default:
        if (tag.startsWith('VCITEM')) {
          if (!curItem) curItem = {}
          curItem[tag] = val || ''
        }
    }
  }

  // Flush any trailing item
  flushItem()

  return results
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const firmParam = req.nextUrl.searchParams.get('firm') || ''
  const fullSync = req.nextUrl.searchParams.get('full') === '1'
  const firmsToSync = firmParam && FIRM_TALLY[firmParam] ? [firmParam] : Object.keys(FIRM_TALLY)
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

      const db = viPrisma as any
      let totalSaved = 0

      for (let fi = 0; fi < firmsToSync.length; fi++) {
        const firmCode = firmsToSync[fi]
        const tallyName = FIRM_TALLY[firmCode]
        const fetchStart = Date.now()
        let firmTotal = 0
        let connectionFailed = false

        // Find last synced date for this firm to resume from (unless full sync requested)
        let startWeekIndex = 0
        if (!fullSync) {
          try {
            const lastEntry = await db.tallySales.findFirst({
              where: { firmCode },
              orderBy: { date: 'desc' },
              select: { date: true, lastSynced: true },
            })
            if (lastEntry?.date) {
              const lastDate = new Date(lastEntry.date)
              for (let wi = 0; wi < weeks.length; wi++) {
                const parts = weeks[wi].to.split('/')
                const weekEnd = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
                if (weekEnd >= lastDate) {
                  startWeekIndex = wi
                  break
                }
              }
            }
          } catch {}
        }

        const skippedWeeks = startWeekIndex
        const remainingWeeks = weeks.length - startWeekIndex

        if (fullSync) {
          send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `Full sync: ${weeks.length} weeks...`, total: weeks.length, progress: 0 })
          try { await db.tallySales.deleteMany({ where: { firmCode } }) } catch {}
        } else if (skippedWeeks > 0) {
          send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `Resuming from week ${startWeekIndex + 1} (${skippedWeeks} already synced). ${remainingWeeks} weeks remaining...`, total: remainingWeeks, progress: 0 })
        } else {
          send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `Fetching ${weeks.length} weeks...`, total: weeks.length, progress: 0 })
          try { await db.tallySales.deleteMany({ where: { firmCode } }) } catch {}
        }

        const now = new Date()

        for (let mi = startWeekIndex; mi < weeks.length; mi++) {
          const m = weeks[mi]
          const progressIndex = mi - startWeekIndex
          const totalToSync = weeks.length - startWeekIndex

          send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `Fetching ${m.label}... (${progressIndex + 1}/${totalToSync})`, total: totalToSync, progress: progressIndex })

          let xml: string
          const apiSecret = process.env.TALLY_API_SECRET || ''
          try {
            const res = await fetch(tunnelUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/xml', 'X-Tally-Key': apiSecret },
              body: buildSalesXML(tallyName, m.from, m.to),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
            xml = await res.text()
          } catch (e: any) {
            // Connection error — stop here, keep progress
            connectionFailed = true
            send({ type: 'progress', firm: firmCode, stage: 'error', message: `✗ ${m.label}: ${e.message}. ${firmTotal} saved. Sync again to resume.` })
            break
          }

          // Parse
          const sales = parseSalesXML(xml)
          xml = '' // Free memory

          if (sales.length > 0) {
            const data = sales.map(s => ({
              firmCode,
              date: s.date,
              vchNumber: s.vchNumber,
              partyName: s.partyName,
              itemName: s.itemName,
              quantity: s.quantity,
              unit: s.unit,
              rate: s.rate,
              amount: s.amount,
              vchType: s.vchType,
              narration: s.narration,
              lastSynced: now,
            }))

            try {
              const r = await db.tallySales.createMany({ data, skipDuplicates: true })
              firmTotal += r.count
            } catch {}
          }

          send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `${m.label}: ${sales.length} items (${progressIndex + 1}/${totalToSync})`, total: totalToSync, progress: progressIndex + 1 })
        }

        totalSaved += firmTotal
        const totalTime = ((Date.now() - fetchStart) / 1000).toFixed(1)

        if (!connectionFailed) {
          send({ type: 'progress', firm: firmCode, stage: 'done', message: `${firmTotal} sales synced across ${weeks.length - startWeekIndex} weeks (${totalTime}s)`, saved: firmTotal })
        }
      }

      send({ type: 'complete', totalSaved })
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  })
}
