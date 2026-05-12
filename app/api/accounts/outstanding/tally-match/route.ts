export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/accounts/outstanding/tally-match
//
// Hits Tally LIVE via Group Summary report for Sundry Debtors with
// EXPLODEFLAG=Yes, parses every customer ledger's closing balance,
// and returns a name→balance map. The Outstanding page compares this
// against its own party net (totalPending − onAccount) and rings the
// matching cards green.
//
// Why live instead of the previously synced TallyOutstanding table:
// Bills Receivable can lag the actual ledger closing balance by days
// (settled bills don't disappear from the report until the sync runs
// again), so reconciliation needed a fresh number every call.

const COMPANY = 'Kothari Synthetic Industries -( from 2023)'

function ymdToday(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

const escapeXml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function buildXML(groupName: string, toDate: string): string {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Group Summary</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${escapeXml(COMPANY)}</SVCURRENTCOMPANY>
        <SVFROMDATE>20250401</SVFROMDATE>
        <SVTODATE>${toDate}</SVTODATE>
        <GROUPNAME>${escapeXml(groupName)}</GROUPNAME>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`
}

// Each ledger row in the response is a <DSPACCNAME> followed by a
// <DSPACCINFO>. Split on <DSPACCNAME> and parse out the display name,
// Dr closing and Cr closing.
function parseGroupSummary(xml: string): Record<string, number> {
  const byParty: Record<string, number> = {}
  const blocks = xml.split(/<DSPACCNAME>/).slice(1)
  for (const blk of blocks) {
    const nameMatch = blk.match(/<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>/)
    if (!nameMatch) continue
    const name = nameMatch[1].trim()
    const drMatch = blk.match(/<DSPCLDRAMTA>([^<]*)<\/DSPCLDRAMTA>/)
    const crMatch = blk.match(/<DSPCLCRAMTA>([^<]*)<\/DSPCLCRAMTA>/)
    const dr = drMatch ? parseFloat((drMatch[1] || '0').replace(/,/g, '')) || 0 : 0
    const cr = crMatch ? parseFloat((crMatch[1] || '0').replace(/,/g, '')) || 0 : 0
    // Tally encodes a Dr closing as a negative DSPCLDRAMTA and a Cr
    // closing as a positive DSPCLCRAMTA. Net = -dr - cr puts Dr (party
    // owes us) as positive, Cr (we owe party) as negative.
    const net = -dr - cr
    byParty[name] = Math.round(net * 100) / 100
  }
  return byParty
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured' }, { status: 500 })

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  const toDate = ymdToday()
  // Fetch Sundry Debtors (party-side receivables). Sundry Creditors
  // is fetched too so we capture parties accidentally classified on
  // the other side; they get a negative number which the UI still
  // compares correctly.
  let byParty: Record<string, number> = {}
  for (const group of ['Sundry Debtors', 'Sundry Creditors']) {
    try {
      const res = await fetch(tunnelUrl, { method: 'POST', headers, body: buildXML(group, toDate) })
      if (!res.ok) continue
      const xml = await res.text()
      const parsed = parseGroupSummary(xml)
      // Merge — duplicate names across groups are unusual but if
      // present we take the sum so the net is still right.
      for (const [name, v] of Object.entries(parsed)) {
        byParty[name] = (byParty[name] || 0) + v
      }
    } catch {
      // skip group on transient error; partial data is still useful
    }
  }

  return NextResponse.json({
    byParty,
    parties: Object.keys(byParty).length,
    lastSynced: new Date().toISOString(),
  })
}
