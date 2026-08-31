// Resolves the applicable process rate for every line of a delivery challan, so
// accounts can raise the job bill from one screen.
//
// There is no FK from a challan line to a grey lot or a rate contract, so the
// resolution walks:
//   FinishDeliveryChallanLine.lotNo -> GreyEntry -> ProcessRateContract
//     -> ProcessRateLine -> rate (flat, or by the line's shade category)
//
// Nothing is ever guessed silently: every line that can't be priced carries an
// `issue` code so the UI can show WHY instead of a misleading zero.

import { prisma } from '@/lib/prisma'
import { lineInclude } from '@/lib/processRates'
import { applyRules, adjustmentPaise, isRealLr, type AppliedRule, type RateRule } from '@/lib/process-rate-rules'

const db = prisma as any

export type RateIssue =
  | 'lot-not-found'      // lotNo matches no grey row for this party
  | 'no-contract'        // neither the lot nor the party has a rate contract
  | 'process-not-set'    // contract has 2+ rate lines and the lot picked none
  | 'category-not-set'   // by-colour rate but the line has no shade category
  | 'rate-missing'       // the matched rate line has no value for this case
  | 'unit-not-than'      // rate is per kg/mtr — than x rate would be wrong

export type LineRate = {
  rate: string | null            // EFFECTIVE rate (base + rule adjustments), Decimal as string
  baseRate: string | null        // the contract rate before rules
  applied: AppliedRule[]         // contract rules that fired on this line
  unit: string | null            // than | kg | mtr
  amount: number | null          // than x effective rate, only when unit === 'than'
  contractVersion: number | null
  contractStatus: string | null
  processTypeName: string | null
  // Context for the expandable slice view
  dyeSlipNo: number | null
  batchThan: number | null       // whole dyeing-batch total (all lots in the slip)
  machineNumber: number | null
  /** 'lot' = the version the lot is linked to; 'fallback-active' = party's current. */
  source: 'lot' | 'fallback-active' | null
  issue?: RateIssue
}

export type ContractUsed = {
  id: number
  version: number
  status: string
  notes: string | null
  effectiveFrom: Date
  /** How this contract was reached, for the version banner. */
  source: 'lot' | 'fallback-active'
  lines: Array<{
    processTypeName: string
    rateMode: string
    unit: string
    rate: string | null
    rateLight: string | null
    rateMedium: string | null
    rateDark: string | null
  }>
  /** Active billing rules on this version — the view renders manual ones as
      tick checkboxes even before they're ticked. */
  rules: Array<{
    id: number
    trigger: string
    label: string
    amountPerThan: number
    processTypeId: number | null
  }>
}

export type ChallanRates = {
  byLineId: Map<number, LineRate>
  contractsUsed: ContractUsed[]
  totals: { amount: number; pricedLines: number; unpricedLines: number; pricedThan: number; unpricedThan: number }
}

const key = (s: string) => s.toLowerCase().trim()

// Decimal strings -> paise-safe multiply. `than` is always a whole number, and
// rates carry at most 2 dp, so scaling by 100 keeps this exact without pulling
// in a Decimal library on a hot path.
function multiply(than: number, rateStr: string): number {
  const paise = Math.round(parseFloat(rateStr) * 100)
  return (paise * than) / 100
}

export async function resolveChallanRates(challanId: number): Promise<ChallanRates> {
  const challan = await db.finishDeliveryChallan.findUnique({
    where: { id: challanId },
    select: {
      partyId: true,
      lines: {
        select: {
          id: true, lotNo: true, than: true, shadeCategory: true,
          transportLrNo: true,
          // Manual rule ticks accounts saved on this line
          ruleTicks: { select: { ruleId: true } },
          // Dye-slip chain for batch-size / machine rules. Batch size must be
          // Σ DyeingEntryLot.than: the slip-edit route re-derives the header
          // `than` from lots[0], so edited multi-lot slips lie in the header.
          finishEntryLot: {
            select: {
              dyeingEntry: {
                select: {
                  slipNo: true, than: true,
                  machine: { select: { number: true } },
                  lots: { select: { than: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  const empty: ChallanRates = {
    byLineId: new Map(),
    contractsUsed: [],
    totals: { amount: 0, pricedLines: 0, unpricedLines: 0, pricedThan: 0, unpricedThan: 0 },
  }
  if (!challan || challan.lines.length === 0) return empty

  // ── 1. lot -> grey entry (party-scoped, newest wins) ──────────────────────
  const lotNos = [...new Set((challan.lines as any[]).map((l: any) => l.lotNo as string))] as string[]
  const greys = await db.greyEntry.findMany({
    where: { lotNo: { in: lotNos, mode: 'insensitive' }, partyId: challan.partyId },
    select: {
      lotNo: true, processRateContractId: true, processTypeId: true, date: true, id: true,
      quality: { select: { widthInch: true } },
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  })
  const greyByLot = new Map<string, { contractId: number | null; processTypeId: number | null; widthInch: number | null }>()
  for (const g of greys as any[]) {
    const k = key(g.lotNo)
    // First row wins — the orderBy above puts the newest grey entry first.
    if (!greyByLot.has(k)) greyByLot.set(k, { contractId: g.processRateContractId ?? null, processTypeId: g.processTypeId ?? null, widthInch: g.quality?.widthInch ?? null })
  }

  // ── 2. load every contract we might need: those the lots are stamped with,
  //       plus the party's active one as the fallback for unstamped lots ─────
  const stampedIds: number[] = [...new Set(
    [...greyByLot.values()].map(v => v.contractId).filter((x): x is number => x != null),
  )]
  const contractInclude = {
    ...lineInclude,
    rules: { where: { active: true }, orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] },
  }
  const [stamped, active] = await Promise.all([
    stampedIds.length
      ? db.processRateContract.findMany({ where: { id: { in: stampedIds } }, include: contractInclude })
      : Promise.resolve([]),
    db.processRateContract.findFirst({ where: { partyId: challan.partyId, status: 'active' }, include: contractInclude }),
  ])
  const contractById = new Map<number, any>()
  for (const c of stamped as any[]) contractById.set(c.id, c)
  if (active && !contractById.has(active.id)) contractById.set(active.id, active)

  // ── 3. resolve each line ──────────────────────────────────────────────────
  const byLineId = new Map<number, LineRate>()
  const usedContractIds = new Map<number, 'lot' | 'fallback-active'>()
  let amount = 0, pricedLines = 0, unpricedLines = 0, pricedThan = 0, unpricedThan = 0

  const fail = (line: any, issue: RateIssue, partial?: Partial<LineRate>): LineRate => ({
    rate: null, baseRate: null, applied: [], unit: null, amount: null,
    contractVersion: null, contractStatus: null, processTypeName: null,
    dyeSlipNo: null, batchThan: null, machineNumber: null,
    source: null, issue, ...partial,
  })

  for (const line of challan.lines as any[]) {
    const grey = greyByLot.get(key(line.lotNo))
    let res: LineRate

    // Dye-slip context for rule evaluation and the slice view.
    const de = line.finishEntryLot?.dyeingEntry ?? null
    const dyeSlipNo: number | null = de?.slipNo ?? null
    const batchThan: number | null = de
      ? (de.lots?.length ? de.lots.reduce((s: number, l: any) => s + (l.than || 0), 0) : de.than ?? null)
      : null
    const machineNumber: number | null = de?.machine?.number ?? null
    const tickedRuleIds = new Set<number>((line.ruleTicks ?? []).map((t: any) => t.ruleId as number))

    if (!grey) {
      res = fail(line, 'lot-not-found')
    } else {
      const source: 'lot' | 'fallback-active' = grey.contractId != null ? 'lot' : 'fallback-active'
      const contract = grey.contractId != null ? contractById.get(grey.contractId) : active

      if (!contract) {
        res = fail(line, 'no-contract')
      } else {
        usedContractIds.set(contract.id, usedContractIds.get(contract.id) ?? source)
        const base = {
          contractVersion: contract.version as number,
          contractStatus: contract.status as string,
          source,
          dyeSlipNo, batchThan, machineNumber,
        }

        // Pick the rate line: the lot's process type, else the sole line.
        const rateLine =
          (grey.processTypeId != null && contract.lines.find((rl: any) => rl.processTypeId === grey.processTypeId))
          || (contract.lines.length === 1 ? contract.lines[0] : null)

        if (!rateLine) {
          res = fail(line, 'process-not-set', base)
        } else {
          const processTypeName = rateLine.processType?.name ?? null
          const unit: string = rateLine.unit || 'kg'
          // FLAT -> single rate; BY_COLOR_CATEGORY -> pick by the line's shade
          // category (Shade.colorCategory is exactly Light|Medium|Dark).
          let rate: string | null = null
          let issue: RateIssue | undefined
          if (rateLine.processType?.rateMode === 'BY_COLOR_CATEGORY') {
            const cat = line.shadeCategory as string | null
            if (!cat) issue = 'category-not-set'
            else {
              const pick = cat === 'Light' ? rateLine.rateLight : cat === 'Medium' ? rateLine.rateMedium : cat === 'Dark' ? rateLine.rateDark : null
              if (pick == null) issue = 'rate-missing'
              else rate = String(pick)
            }
          } else {
            if (rateLine.rate == null) issue = 'rate-missing'
            else rate = String(rateLine.rate)
          }

          if (!rate) {
            res = { ...fail(line, issue ?? 'rate-missing', base), unit, processTypeName }
          } else if (unit !== 'than') {
            // Only `than` is reliably known per lot — never treat a per-kg rate
            // as per-than. Show the rate, withhold the amount. Rule adjustments
            // are per-than too, so they deliberately don't apply here either.
            res = { ...base, rate, baseRate: rate, applied: [], unit, amount: null, processTypeName, issue: 'unit-not-than' }
          } else {
            // Contract rules adjust the per-than rate BEFORE the multiply, so
            // Amount === Than × displayed Rate always holds, in paise space.
            const applied = applyRules((contract.rules ?? []) as RateRule[], {
              processTypeId: rateLine.processTypeId,
              batchThan, widthInch: grey.widthInch, machineNumber,
              hasRealLr: isRealLr(line.transportLrNo),
              tickedRuleIds,
            })
            const effPaise = Math.round(parseFloat(rate) * 100) + adjustmentPaise(applied)
            const effRate = (effPaise / 100).toFixed(2)
            res = { ...base, rate: effRate, baseRate: rate, applied, unit, amount: multiply(line.than, effRate), processTypeName }
          }
        }
      }
    }

    if (res.amount != null) { amount += res.amount; pricedLines++; pricedThan += line.than }
    else { unpricedLines++; unpricedThan += line.than }
    byLineId.set(line.id, res)
  }

  const contractsUsed: ContractUsed[] = [...usedContractIds.entries()].map(([id, source]) => {
    const c = contractById.get(id)
    return {
      id: c.id, version: c.version, status: c.status, notes: c.notes ?? null,
      effectiveFrom: c.effectiveFrom, source,
      lines: (c.lines as any[]).map(rl => ({
        processTypeName: rl.processType?.name ?? '—',
        rateMode: rl.processType?.rateMode ?? 'FLAT',
        unit: rl.unit || 'kg',
        rate: rl.rate == null ? null : String(rl.rate),
        rateLight: rl.rateLight == null ? null : String(rl.rateLight),
        rateMedium: rl.rateMedium == null ? null : String(rl.rateMedium),
        rateDark: rl.rateDark == null ? null : String(rl.rateDark),
      })),
      rules: ((c.rules ?? []) as any[]).map(r => ({
        id: r.id, trigger: r.trigger, label: r.label,
        amountPerThan: Number(r.amountPerThan), processTypeId: r.processTypeId ?? null,
      })),
    }
  }).sort((a, b) => a.version - b.version)

  return {
    byLineId,
    contractsUsed,
    totals: { amount: Math.round(amount * 100) / 100, pricedLines, unpricedLines, pricedThan, unpricedThan },
  }
}

export const RATE_ISSUE_LABEL: Record<RateIssue, string> = {
  'lot-not-found': 'lot not found',
  'no-contract': 'no rate contract',
  'process-not-set': 'process not set',
  'category-not-set': 'colour category not set',
  'rate-missing': 'rate not filled',
  'unit-not-than': 'per-unit rate — compute manually',
}
