export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 60

function decodeXML(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '').replace(/&#10;/g, '').trim()
}

function buildLedgerXML(tallyCompany: string): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerExport</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${tallyCompany}</SVCURRENTCOMPANY>
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

async function updateMasterSheet(ledgers: any[]): Promise<{ debtors: string[] } | null> {
  const { GoogleAuth } = await import('google-auth-library')
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null
  const sheetId = '1FkDEA84AWJxHBMTX7ku67TRdIo-GP1VMOzO_3ZOUVMo'
  const sheetName = 'Master Sheet'
  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  const client = await auth.getClient()
  const token = (await client.getAccessToken()).token
  if (!token) return null

  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`

  // Ensure "Master Sheet" tab exists
  const metaRes = await fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } })
  const meta = await metaRes.json()
  const existing = meta.sheets?.find((s: any) => s.properties?.title === sheetName)
  if (!existing) {
    await fetch(`${baseUrl}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
    })
  }

  // Filter debtors for column L source range
  const debtors = ledgers
    .filter((l: any) => l.parent && /sund(ry|ary|ury|ery)\s+debtors?/i.test(l.parent))
    .map((l: any) => l.name)
    .sort()

  // Build rows: header + data (10 cols A-J ledger data, col L = debtor names for dropdown)
  const header = ['Name', 'Parent Group', 'Address', 'GST No', 'PAN No', 'Mobile', 'State', 'Closing Balance', 'Tags', 'Last Synced', '', 'Sundry Debtors (dropdown source)']
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  const maxRows = Math.max(ledgers.length, debtors.length)
  const rows = [header]
  for (let i = 0; i < maxRows; i++) {
    const l = ledgers[i]
    rows.push([
      l?.name || '',
      l?.parent || '',
      l?.address || '',
      l?.gstNo || '',
      l?.panNo || '',
      l?.mobileNos || '',
      l?.state || '',
      l?.closingBalance != null ? String(l.closingBalance) : '',
      Array.isArray(l?.tags) ? l.tags.join(', ') : '',
      l ? now : '',
      '',
      debtors[i] || '',
    ])
  }

  // Clear and write (up to column L)
  const range = encodeURIComponent(`'${sheetName}'!A1:L${rows.length + 1}`)
  await fetch(`${baseUrl}/values/${range}:clear`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  await fetch(`${baseUrl}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  })

  return { debtors }
}

async function updateDebtorsDropdown(debtors: string[]) {
  const { GoogleAuth } = await import('google-auth-library')
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return
  const sheetId = (process.env.GOOGLE_SHEET_ID || '').trim()
  const grayName = (process.env.GOOGLE_SHEET_NAME || 'INWERD GRAY').trim()
  if (!sheetId || debtors.length === 0) return

  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  const client = await auth.getClient()
  const token = (await client.getAccessToken()).token
  if (!token) return

  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`

  // Find sheet numeric ID
  const metaRes = await fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } })
  const meta = await metaRes.json()
  const gray = meta.sheets?.find((s: any) => s.properties?.title === grayName)
  if (!gray) return
  const grayGid = gray.properties.sheetId

  // Use ONE_OF_LIST with inline values — renders as CHIP-style dropdown,
  // which is searchable in the Google Sheets Android/iOS app (unlike ONE_OF_RANGE).
  await fetch(`${baseUrl}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        setDataValidation: {
          range: {
            sheetId: grayGid,
            startRowIndex: 2,     // row 3 (0-indexed)
            endRowIndex: 10000,
            startColumnIndex: 4,  // column E
            endColumnIndex: 5,
          },
          rule: {
            condition: {
              type: 'ONE_OF_LIST',
              values: debtors.map(name => ({ userEnteredValue: name })),
            },
            showCustomUi: true,
            strict: false,
          },
        },
      }],
    }),
  })
}

async function doSync(): Promise<{ count: number; duration: number; error?: string }> {
  const start = Date.now()
  const db = prisma as any

  // Load config from DB
  const config = await db.tallyConfig.findUnique({ where: { firmCode: 'KSI' } })
  const tunnelUrl = config?.tallyTunnelUrl || process.env.TALLY_TUNNEL_URL
  const tallyCompany = config?.tallyCompanyName || 'Kothari Synthetic Industries -( from 2023)'
  if (!tunnelUrl) throw new Error('TALLY_TUNNEL_URL not configured. Go to Tally Settings.')

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (config?.tallyApiSecret || process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = config?.tallyApiSecret || process.env.TALLY_API_SECRET!
  if (config?.cfAccessClientId || process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = config?.cfAccessClientId || process.env.CF_ACCESS_CLIENT_ID!
  if (config?.cfAccessClientSecret || process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = config?.cfAccessClientSecret || process.env.CF_ACCESS_CLIENT_SECRET!

  const res = await fetch(tunnelUrl, { method: 'POST', headers, body: buildLedgerXML(tallyCompany), signal: AbortSignal.timeout(50000) })
  if (!res.ok) throw new Error(`Tally HTTP ${res.status} ${res.statusText}`)

  const xml = await res.text()
  if (!xml.includes('<LEDGER')) throw new Error('No ledger data in response')

  // Step 1 done: Tally connection closed, XML in memory

  // Step 2: Parse (fast, no network)
  const ledgers = parseLedgers(xml)
  if (ledgers.length === 0) throw new Error('Parsed 0 ledgers')

  // Step 3: Fast bulk save — delete all KSI + createMany in batches of 2000
  const now = new Date()
  const BATCH_SIZE = 2000

  // Snapshot user-managed tags BEFORE the wipe so they survive the
  // delete-and-recreate cycle. Keyed by ledger.name (the stable identity).
  const tagSnapshotRows = await db.tallyLedger.findMany({
    where: { firmCode: 'KSI', NOT: { tags: { isEmpty: true } } },
    select: { name: true, tags: true },
  })
  const tagSnapshot = new Map<string, string[]>(
    tagSnapshotRows.map((r: any) => [r.name, r.tags as string[]]),
  )

  // Delete all existing KSI ledgers (fast clean slate)
  await db.tallyLedger.deleteMany({ where: { firmCode: 'KSI' } })

  // Bulk insert in batches of 2000 — re-apply tags from snapshot inline.
  let synced = 0
  const seen = new Set<string>()
  const deduped = ledgers.filter(l => { if (seen.has(l.name)) return false; seen.add(l.name); return true })

  const buildRow = (l: any) => ({
    firmCode: 'KSI', name: l.name, parent: l.parent, address: l.address,
    gstNo: l.gstNo, panNo: l.panNo, mobileNos: l.mobileNos, state: l.state,
    closingBalance: l.closingBalance, lastSynced: now,
    tags: tagSnapshot.get(l.name) ?? [],
  })

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE)
    try {
      const result = await db.tallyLedger.createMany({
        data: batch.map(buildRow),
        skipDuplicates: true,
      })
      synced += result.count
    } catch {
      // Fallback: smaller batches
      for (let j = 0; j < batch.length; j += 200) {
        try {
          const r = await db.tallyLedger.createMany({
            data: batch.slice(j, j + 200).map(buildRow),
            skipDuplicates: true,
          })
          synced += r.count
        } catch {}
      }
    }
  }

  // Fetch all ledgers once for sheet updates + actual count (createMany returns 0 on PgBouncer)
  const allLedgers = await db.tallyLedger.findMany({
    where: { firmCode: 'KSI' },
    orderBy: { name: 'asc' },
  })
  const actualCount = allLedgers.length

  // Update Google Sheet with all KSI ledgers + dropdown source range
  try {
    const result = await updateMasterSheet(allLedgers)
    if (result) await updateDebtorsDropdown(result.debtors)
  } catch (e: any) {
    console.error('Sheet update failed:', e?.message || e)
  }

  const duration = (Date.now() - start) / 1000
  return { count: actualCount, duration }
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

        send({ type: 'complete', message: `✅ Sync complete — ${result.count} ledgers in ${result.duration.toFixed(1)}s`, count: result.count, totalSaved: result.count })
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
