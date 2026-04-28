import { prisma } from '@/lib/prisma'

const db = prisma as any

export interface ValidationFailure {
  code: string
  message: string
  field?: string
}

/**
 * Runs every pre-push check from PRD §6.4 and returns a list of
 * failures. Empty array → ready to push.
 */
export async function prePushValidate(invoiceId: number): Promise<ValidationFailure[]> {
  const failures: ValidationFailure[] = []

  const inv = await db.invPurchaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      party: true,
      lines: { include: { item: { include: { alias: true } } } },
    },
  })
  if (!inv) return [{ code: 'NOT_FOUND', message: 'Invoice not found' }]

  // Tally tunnel env
  if (!process.env.TALLY_TUNNEL_URL) failures.push({ code: 'NO_TUNNEL', message: 'TALLY_TUNNEL_URL env not configured' })

  // Party ledger present
  if (!inv.party.tallyLedger) failures.push({ code: 'NO_PARTY_LEDGER', message: `Party ${inv.party.displayName} has no tallyLedger` })

  // Tally config seeded
  const cfg = await db.invTallyConfig.findUnique({ where: { id: 1 } })
  if (!cfg) {
    failures.push({ code: 'NO_CONFIG', message: 'Tally config row missing — visit /inventory/config' })
    return failures // no point checking ledger names without cfg
  }

  // Categories needed
  const categoriesNeeded = new Set<string>()
  const ratesNeeded = new Set<string>()
  for (const l of inv.lines) {
    if (l.item) {
      categoriesNeeded.add(l.item.alias.category)
      if (l.item.unit !== l.item.alias.unit) {
        failures.push({ code: 'UNIT_MISMATCH', message: `Item ${l.item.displayName} unit (${l.item.unit}) ≠ alias unit (${l.item.alias.unit})` })
      }
      if (l.item.reviewStatus === 'pending_review') {
        failures.push({ code: 'PENDING_ITEM', message: `Item ${l.item.displayName} is pending review` })
      } else if (l.item.reviewStatus === 'rejected') {
        failures.push({ code: 'REJECTED_ITEM', message: `Item ${l.item.displayName} is rejected` })
      }
    }
    if (l.rate == null || l.amount == null) {
      failures.push({ code: 'NO_RATE', message: `Line ${l.lineNo} has no rate/amount` })
    }
    if (l.gstRate != null) ratesNeeded.add(String(Number(l.gstRate)))
    if (l.description && l.description.length > 240) {
      failures.push({ code: 'DESC_TOO_LONG', message: `Line ${l.lineNo} description >240 chars (will be truncated)` })
    }
  }

  for (const cat of categoriesNeeded) {
    if (!cfg.purchaseLedgerMap?.[cat]) failures.push({ code: 'NO_PURCHASE_LEDGER', message: `purchaseLedgerMap.${cat} not configured` })
    if (!cfg.godownMap?.[cat]) failures.push({ code: 'NO_GODOWN', message: `godownMap.${cat} not configured` })
  }

  // GST ledgers (only for Regular)
  if (inv.gstTreatment === 'IGST') {
    for (const r of ratesNeeded) {
      if (!cfg.gstLedgers?.IGST?.[r]) failures.push({ code: 'NO_IGST_LEDGER', message: `IGST ledger for ${r}% not configured` })
    }
  } else if (inv.gstTreatment === 'CGST_SGST') {
    for (const r of ratesNeeded) {
      const half = String(Number(r) / 2)
      if (!cfg.gstLedgers?.CGST?.[half]) failures.push({ code: 'NO_CGST_LEDGER', message: `CGST ledger for ${half}% not configured` })
      if (!cfg.gstLedgers?.SGST?.[half]) failures.push({ code: 'NO_SGST_LEDGER', message: `SGST ledger for ${half}% not configured` })
    }
  }

  return failures
}
