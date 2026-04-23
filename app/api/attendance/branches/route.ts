export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPetpoojaAuth, attnHeaders, PETPOOJA_ATTN_BASE } from '@/lib/petpooja'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let auth
  try { auth = await getPetpoojaAuth() }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }) }

  const res = await fetch(`${PETPOOJA_ATTN_BASE}/organizations/get_organizations`, {
    method: 'GET',
    headers: attnHeaders(auth),
  })
  const text = await res.text()
  if (!res.ok) return NextResponse.json({ error: `Petpooja ${res.status}`, body: text.slice(0, 500) }, { status: res.status })
  try {
    const data = JSON.parse(text)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Non-JSON response from Petpooja', body: text.slice(0, 500) }, { status: 502 })
  }
}
