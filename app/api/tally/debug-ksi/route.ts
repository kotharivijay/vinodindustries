export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL || ''
  const apiSecret = process.env.TALLY_API_SECRET || ''

  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not set' })

  const companyName = 'Kothari Synthetic Industries -( from 2023)'

  const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerExport</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="LedgerExport" ISMODIFY="No">
<TYPE>Ledger</TYPE>
<FETCH>Name,Parent</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`

  try {
    const res = await fetch(tunnelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-Tally-Key': apiSecret,
        ...(process.env.CF_ACCESS_CLIENT_ID && { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID }),
        ...(process.env.CF_ACCESS_CLIENT_SECRET && { 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET }),
      },
      body: xml,
    })

    const raw = await res.text()
    const ledgerCount = (raw.match(/<LEDGER NAME="/g) || []).length
    const first500 = raw.slice(0, 500)
    const last200 = raw.slice(-200)

    return NextResponse.json({
      httpStatus: res.status,
      companyNameUsed: companyName,
      ledgerTagsFound: ledgerCount,
      responseLength: raw.length,
      first500,
      last200,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message })
  }
}
