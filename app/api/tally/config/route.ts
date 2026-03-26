import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getFirms, queryTally } from '@/lib/tally'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const firms = getFirms()
  let connected = false

  try {
    // Quick ping test
    const xml = '<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Companies</REPORTNAME></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>'
    await queryTally(xml)
    connected = true
  } catch {
    // Tally not reachable
  }

  return NextResponse.json({ firms, connected, tunnelConfigured: !!process.env.TALLY_TUNNEL_URL })
}
