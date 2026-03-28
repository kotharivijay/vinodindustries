const TUNNEL_URL = process.env.TALLY_TUNNEL_URL || ''
const API_SECRET = process.env.TALLY_API_SECRET || ''

const FIRMS: Record<string, { code: string; name: string; tallyName: string }> = {
  VI: { code: 'VI', name: 'Vinod Industries', tallyName: 'Vinod Industries - (from 1-Apr-25)' },
  VCF: { code: 'VCF', name: 'Vimal Cotton Fabrics', tallyName: 'Vimal Cotton Fabrics' },
  VF: { code: 'VF', name: 'Vijay Fabrics', tallyName: 'Vijay Fabrics - (from 1-Apr-2019)' },
  KSI: { code: 'KSI', name: 'Kothari Synthetic Industries', tallyName: 'Kothari Synthetic Industries -( from 2023)' },
}

export function getFirms() { return FIRMS }
export function getFirm(code: string) { return FIRMS[code] }

export async function queryTally(xml: string): Promise<string> {
  if (!TUNNEL_URL) throw new Error('TALLY_TUNNEL_URL not configured')

  const headers: Record<string, string> = {
    'Content-Type': 'text/xml',
    'X-Tally-Key': API_SECRET,
  }
  // Cloudflare Access service token headers
  const cfClientId = process.env.CF_ACCESS_CLIENT_ID
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfClientId && cfClientSecret) {
    headers['CF-Access-Client-Id'] = cfClientId
    headers['CF-Access-Client-Secret'] = cfClientSecret
  }

  const res = await fetch(TUNNEL_URL, {
    method: 'POST',
    headers,
    body: xml,
  })

  if (!res.ok) throw new Error(`Tally error: ${res.status}`)
  return res.text()
}

export function buildLedgerExportXML(tallyCompanyName: string): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerExport</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${tallyCompanyName}</SVCURRENTCOMPANY>
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

export interface ParsedLedger {
  name: string
  parent: string | null
  address: string | null
  gstNo: string | null
  panNo: string | null
  mobileNos: string | null
  state: string | null
}

export function parseLedgersXML(xml: string): ParsedLedger[] {
  const ledgers: ParsedLedger[] = []

  // Simple regex-based XML parsing (Tally XML is consistent)
  const ledgerBlocks = xml.match(/<LEDGER NAME="[^"]*"[\s\S]*?<\/LEDGER>/g) || []

  for (const block of ledgerBlocks) {
    const name = block.match(/LEDGER NAME="([^"]*)"/)?.[1] || ''
    const parent = block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/)?.[1] || null

    // Address: multiple ADDRESS lines
    const addressLines = block.match(/<ADDRESS TYPE="String">([^<]*)<\/ADDRESS>/g)?.map(a => a.replace(/<[^>]+>/g, '')) || []
    const address = addressLines.length ? addressLines.join(', ') : null

    const state = block.match(/<LEDSTATENAME[^>]*>([^<]*)<\/LEDSTATENAME>/)?.[1] || null
    const gstNo = block.match(/<PARTYGSTIN[^>]*>([^<]*)<\/PARTYGSTIN>/)?.[1] || null
    const panNo = block.match(/<INCOMETAXNUMBER[^>]*>([^<]*)<\/INCOMETAXNUMBER>/)?.[1] || null

    const mobile = block.match(/<LEDGERMOBILE[^>]*>([^<]*)<\/LEDGERMOBILE>/)?.[1] || null
    const phone = block.match(/<LEDGERPHONE[^>]*>([^<]*)<\/LEDGERPHONE>/)?.[1] || null
    const mobileNos = [mobile, phone].filter(Boolean).join(', ') || null

    if (name) {
      ledgers.push({ name, parent, address, gstNo, panNo, mobileNos, state })
    }
  }

  return ledgers
}
