export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchPartiesFromTally } from '@/lib/inv/tally-masters'

export const maxDuration = 60

const db = prisma as any

/**
 * Pull every Sundry Creditor / Debtor from KSI's Tally company and
 * upsert into InvParty by tallyLedger.
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let fetched
  try { fetched = await fetchPartiesFromTally() }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 502 }) }

  let inserted = 0, updated = 0
  for (const p of fetched) {
    const existing = await db.invParty.findUnique({ where: { tallyLedger: p.tallyLedger } })
    if (existing) {
      await db.invParty.update({
        where: { tallyLedger: p.tallyLedger },
        data: {
          tallyGuid: p.tallyGuid,
          parentGroup: p.parentGroup,
          state: p.state,
          gstin: p.gstin,
          // Don't overwrite a manually-edited gstRegistrationType — Tally
          // sometimes returns 'Regular' for parties the user has tagged
          // 'Unregistered'. Only set on first create.
          whatsapp: existing.whatsapp || p.whatsapp,
          email: existing.email || p.email,
          lastSyncedAt: new Date(),
        },
      })
      updated++
    } else {
      await db.invParty.create({
        data: {
          tallyLedger: p.tallyLedger,
          tallyGuid: p.tallyGuid,
          displayName: p.tallyLedger,
          gstin: p.gstin,
          state: p.state,
          city: p.city,
          whatsapp: p.whatsapp,
          email: p.email,
          parentGroup: p.parentGroup,
          gstRegistrationType: p.gstRegistrationType,
          lastSyncedAt: new Date(),
        },
      })
      inserted++
    }
  }
  return NextResponse.json({ ok: true, inserted, updated, total: fetched.length })
}
