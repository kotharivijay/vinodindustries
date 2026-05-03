import { prisma } from '@/lib/prisma'

const db = prisma as any

/**
 * Resolve a Tally ledger name to an InvParty.id, creating a row if missing.
 * The picker on Inward Challan / new sources from /api/tally/ledgers (the
 * accounts ledger master) instead of InvParty, so on save we mint an
 * InvParty record on demand from the matching TallyLedger row.
 */
export async function resolvePartyIdByLedger(tallyLedger: string): Promise<number> {
  const name = tallyLedger.trim()
  if (!name) throw new Error('tallyLedger required')

  const existing = await db.invParty.findUnique({ where: { tallyLedger: name } })
  if (existing) return existing.id

  // Pull whatever metadata we can from the live ledger master (KSI firm)
  const led = await db.tallyLedger.findFirst({ where: { firmCode: 'KSI', name } })
  const created = await db.invParty.create({
    data: {
      tallyLedger: name,
      displayName: name,
      parentGroup: led?.parent ?? null,
      gstin: led?.gstNo ?? null,
      state: led?.state ?? null,
      whatsapp: led?.mobileNos ?? null,
      gstRegistrationType: 'Regular',
      active: true,
      lastSyncedAt: new Date(),
    },
  })
  return created.id
}
