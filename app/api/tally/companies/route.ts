export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { queryTally } from '@/lib/tally'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CompanyList</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="CompanyList" ISMODIFY="No">
<TYPE>Company</TYPE>
<FETCH>Name,StartingFrom,Books</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`

  try {
    const raw = await queryTally(xml)
    // Parse company names from XML
    const names = [...raw.matchAll(/COMPANY NAME="([^"]*)"/g)].map(m => m[1])
    // Also try inner NAME tags inside COMPANY blocks
    const blocks = raw.match(/<COMPANY NAME="[^"]*"[\s\S]*?<\/COMPANY>/g) || []
    const companies = blocks.map(b => {
      const name = b.match(/COMPANY NAME="([^"]*)"/)?.[1] || ''
      const startDate = b.match(/<STARTINGFROM[^>]*>([^<]*)<\/STARTINGFROM>/)?.[1] || null
      const books = b.match(/<BOOKS[^>]*>([^<]*)<\/BOOKS>/)?.[1] || null
      return { name, startDate, books }
    }).filter(c => c.name)

    return NextResponse.json({ companies: companies.length ? companies : names.map(n => ({ name: n })), raw: raw.slice(0, 2000) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
