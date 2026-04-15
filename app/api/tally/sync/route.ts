export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getFirm, getFirms, queryTally, buildLedgerExportXML, parseLedgersXML } from '@/lib/tally'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { firmCode } = await req.json()

  // If firmCode is 'ALL', sync all firms
  const firmsToSync = firmCode === 'ALL'
    ? Object.values(getFirms())
    : [getFirm(firmCode)].filter(Boolean)

  if (firmsToSync.length === 0) return NextResponse.json({ error: 'Invalid firm code' }, { status: 400 })

  const db = viPrisma as any
  const results: { firm: string; synced: number; errors: number }[] = []

  for (const firm of firmsToSync) {
    try {
      const xml = buildLedgerExportXML(firm.tallyName)
      const response = await queryTally(xml)
      const ledgers = parseLedgersXML(response)

      let synced = 0, errors = 0
      for (const ledger of ledgers) {
        try {
          await db.tallyLedger.upsert({
            where: { firmCode_name: { firmCode: firm.code, name: ledger.name } },
            create: {
              firmCode: firm.code,
              name: ledger.name,
              parent: ledger.parent,
              address: ledger.address,
              gstNo: ledger.gstNo,
              panNo: ledger.panNo,
              mobileNos: ledger.mobileNos,
              state: ledger.state,
              lastSynced: new Date(),
            },
            update: {
              parent: ledger.parent,
              address: ledger.address,
              gstNo: ledger.gstNo,
              panNo: ledger.panNo,
              mobileNos: ledger.mobileNos,
              state: ledger.state,
              lastSynced: new Date(),
            },
          })
          synced++
        } catch {
          errors++
        }
      }
      results.push({ firm: firm.code, synced, errors })
    } catch {
      results.push({ firm: firm.code, synced: 0, errors: -1 })
    }
  }

  return NextResponse.json({ results })
}
