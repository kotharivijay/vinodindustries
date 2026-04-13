import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'https://vinodindustries.vercel.app'

  // Trigger KSI ledger sync
  try {
    const res = await fetch(`${baseUrl}/api/tally/ledger-sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cronSecret}` },
    })
    const data = await res.json()
    return Response.json({ ksi_ledger: data })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
