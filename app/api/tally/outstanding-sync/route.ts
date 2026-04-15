export const dynamic = 'force-dynamic'
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

function buildBillXML(tallyCompany: string, report: string): string {
  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
<STATICVARIABLES>
<SVCURRENTCOMPANY>${tallyCompany}</SVCURRENTCOMPANY>
<SVFROMDATE>20190401</SVFROMDATE>
<SVTODATE>20260331</SVTODATE>
<EXPLODEFLAG>Yes</EXPLODEFLAG>
</STATICVARIABLES>
<REPORTNAME>${report}</REPORTNAME>
</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`
}

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
}

function parseBills(text: string, type: string): any[] {
  const bills: any[] = []

  // Detect format: XML has <BILLFIXED>, CSV is comma-separated lines
  if (text.includes('<BILLFIXED>')) {
    // XML format
    const parts = text.split(/<BILLFIXED>/).slice(1)
    for (const part of parts) {
      const billDate = part.match(/<BILLDATE>([^<]*)<\/BILLDATE>/)?.[1] || ''
      const billRef = decodeHtml(part.match(/<BILLREF>([^<]*)<\/BILLREF>/)?.[1] || '')
      const partyName = decodeHtml(part.match(/<BILLPARTY>([^<]*)<\/BILLPARTY>/)?.[1]?.trim() || '')
      const closingBalance = parseFloat((part.match(/<BILLCL>([^<]*)<\/BILLCL>/)?.[1] || '0').replace(/,/g, '')) || 0
      const dueDate = part.match(/<BILLDUE>([^<]*)<\/BILLDUE>/)?.[1] || ''
      const overdueDays = parseInt(part.match(/<BILLOVERDUE>([^<]*)<\/BILLOVERDUE>/)?.[1] || '0') || 0
      const vchType = part.match(/<BILLVCHTYPE>([^<]*)<\/BILLVCHTYPE>/)?.[1] || ''
      const vchNumber = part.match(/<BILLVCHNUMBER>([^<]*)<\/BILLVCHNUMBER>/)?.[1] || ''
      const vchAmount = parseFloat((part.match(/<BILLVCHAMOUNT>([^<]*)<\/BILLVCHAMOUNT>/)?.[1] || '0').replace(/,/g, '')) || 0
      if (partyName && billRef) {
        bills.push({ partyName, type, billRef, billDate: parseTallyDate(billDate), dueDate: parseTallyDate(dueDate), overdueDays, closingBalance: Math.abs(closingBalance), vchType, vchNumber, vchAmount })
      }
    }
  } else {
    // CSV format: date,"billRef","partyName",amount,dueDate,"overdueDays"
    // Each bill starts with a date line, followed by voucher detail lines
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    let curParty = '', curBillRef = '', curBillDate = '', curDueDate = '', curOverdue = 0, curAmount = 0

    for (const line of lines) {
      // Parse CSV fields — handle quoted values
      const fields: string[] = []
      let current = '', inQuote = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') { inQuote = !inQuote; continue }
        if (ch === ',' && !inQuote) { fields.push(current.trim()); current = ''; continue }
        current += ch
      }
      fields.push(current.trim())

      if (fields.length < 4) continue

      // Bill header line: date, billRef, partyName, amount, dueDate, overdueDays
      // Voucher detail line: date, vchType, vchNumber, amount (no party)
      const firstField = fields[0]
      const hasDate = /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(firstField)
      if (!hasDate) continue

      // Check if this is a bill header (has party name with spaces/letters in field 2)
      const field2 = fields[2] || ''
      const isPartyLine = field2.length > 3 && /[A-Za-z]/.test(field2) && !/^(Sales|Purchase|Receipt|Payment|Journal|Contra|Credit Note|Debit Note)$/i.test(field2)

      if (isPartyLine && fields.length >= 5) {
        // Bill header: date, billRef, partyName, amount, dueDate, overdueDays
        curBillDate = firstField
        curBillRef = fields[1] || ''
        curParty = field2
        curAmount = parseFloat((fields[3] || '0').replace(/,/g, '')) || 0
        curDueDate = fields[4] || ''
        curOverdue = parseInt(fields[5] || '0') || 0

        if (curParty && curBillRef) {
          bills.push({
            partyName: curParty,
            type,
            billRef: curBillRef,
            billDate: parseTallyDate(curBillDate),
            dueDate: parseTallyDate(curDueDate),
            overdueDays: curOverdue,
            closingBalance: Math.abs(curAmount),
            vchType: '',
            vchNumber: curBillRef,
            vchAmount: Math.abs(curAmount),
          })
        }
      }
    }
  }
  return bills
}

function parseTallyDate(dateStr: string): Date | null {
  if (!dateStr) return null
  // Format: "8-Aug-21" or "13-May-22"
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

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
      const tallyHeaders: Record<string, string> = { 'Content-Type': 'text/xml' }
      if (process.env.TALLY_API_SECRET) tallyHeaders['X-Tally-Key'] = process.env.TALLY_API_SECRET
      if (process.env.CF_ACCESS_CLIENT_ID) tallyHeaders['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
      if (process.env.CF_ACCESS_CLIENT_SECRET) tallyHeaders['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

      const db = viPrisma as any
      let totalSaved = 0

      for (let fi = 0; fi < firmsToSync.length; fi++) {
        const firmCode = firmsToSync[fi]
        const tallyName = FIRM_TALLY[firmCode]
        const fetchStart = Date.now()

        // Fetch Receivable (Bills Receivable)
        send({ type: 'progress', firm: firmCode, stage: 'fetching', message: 'Fetching Bills Receivable...' })
        let receivables: any[] = []
        try {
          const res = await fetch(tunnelUrl, {
            method: 'POST',
            headers: tallyHeaders,
            body: buildBillXML(tallyName, 'Bills Receivable'),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
          const xml = await res.text()
          receivables = parseBills(xml, 'receivable')
          send({ type: 'progress', firm: firmCode, stage: 'fetching', message: `Receivable: ${receivables.length} bills. Fetching Payable...` })
        } catch (e: any) {
          send({ type: 'progress', firm: firmCode, stage: 'error', message: `✗ Receivables: ${e.message}` })
          continue
        }

        // Fetch Payable (Bills Payable)
        let payables: any[] = []
        try {
          const res = await fetch(tunnelUrl, {
            method: 'POST',
            headers: tallyHeaders,
            body: buildBillXML(tallyName, 'Bills Payable'),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
          const xml = await res.text()
          payables = parseBills(xml, 'payable')
        } catch (e: any) {
          send({ type: 'progress', firm: firmCode, stage: 'error', message: `✗ Payables: ${e.message}` })
          continue
        }

        const allBills = [...receivables, ...payables]
        send({ type: 'progress', firm: firmCode, stage: 'saving', message: `Parsed ${receivables.length} receivable + ${payables.length} payable. Saving...`, total: allBills.length, progress: 0 })

        // Delete old data for this firm
        try { await db.tallyOutstanding.deleteMany({ where: { firmCode } }) } catch {}

        // Deduplicate and bulk insert
        const now = new Date()
        const seen = new Set<string>()
        const data: any[] = []
        for (const bill of allBills) {
          const key = `${firmCode}|${bill.partyName}|${bill.billRef}|${bill.type}`
          if (seen.has(key)) continue
          seen.add(key)
          data.push({
            firmCode,
            partyName: bill.partyName,
            parent: bill.type === 'receivable' ? 'Sundry Debtors' : 'Sundry Creditors',
            type: bill.type,
            billRef: bill.billRef,
            billDate: bill.billDate,
            dueDate: bill.dueDate,
            overdueDays: bill.overdueDays,
            closingBalance: bill.closingBalance,
            vchType: bill.vchType,
            vchNumber: bill.vchNumber,
            vchAmount: bill.vchAmount,
            lastSynced: now,
          })
        }

        let saved = 0
        const BATCH = 500
        for (let b = 0; b < data.length; b += BATCH) {
          const batch = data.slice(b, b + BATCH)
          try {
            const r = await db.tallyOutstanding.createMany({ data: batch, skipDuplicates: true })
            saved += r.count
          } catch {}
          send({ type: 'progress', firm: firmCode, stage: 'saving', message: `Saving... ${Math.min(b + BATCH, data.length)} of ${data.length}`, total: data.length, progress: Math.min(b + BATCH, data.length) })
        }

        totalSaved += saved
        const totalTime = ((Date.now() - fetchStart) / 1000).toFixed(1)
        send({ type: 'progress', firm: firmCode, stage: 'done', message: `${saved} bills synced (${totalTime}s) — ${receivables.length} receivable, ${payables.length} payable`, saved })
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
