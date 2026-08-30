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

const db = prisma as any

export type RateIssue =
  | 'lot-not-found'      // lotNo matches no grey row for this party
  | 'no-contract'        // neither the lot nor the party has a rate contract
  | 'process-not-set'    // contract has 2+ rate lines and the lot picked none
  | 'category-not-set'   // by-colour rate but the line has no shade category
  | 'rate-missing'       // the matched rate line has no value for this case
  | 'unit-not-than'      // rate is per kg/mtr — than x rate would be wrong

export type LineRate = {
  rate: string | null            // Decimal as string (wire convention)
  unit: string | null            // than | kg | mtr
  amount: number | null          // than x rate, only when unit === 'than'
  contractVersion: number | null
  contractStatus: string | null
  processTypeName: string | null
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
      lines: { select: { id: true, lotNo: true, than: true, shadeCategory: true } },
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
    select: { lotNo: true, processRateContractId: true, processTypeId: true, date: true, id: true },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  })
  const greyByLot = new Map<string, { contractId: number | null; processTypeId: number | null }>()
  for (const g of greys as any[]) {
    const k = key(g.lotNo)
    // First row wins — the orderBy above puts the newest grey entry first.
    if (!greyByLot.has(k)) greyByLot.set(k, { contractId: g.processRateContractId ?? null, processTypeId: g.processTypeId ?? null })
  }

  // ── 2. load every contract we might need: those the lots are stamped with,
  //       plus the party's active one as the fallback for unstamped lots ─────
  const stampedIds: number[] = [...new Set(
    [...greyByLot.values()].map(v => v.contractId).filter((x): x is number => x != null),
  )]
  const [stamped, active] = await Promise.all([
    stampedIds.length
      ? db.processRateContract.findMany({ where: { id: { in: stampedIds } }, include: lineInclude })
      : Promise.resolve([]),
    db.processRateContract.findFirst({ where: { partyId: challan.partyId, status: 'active' }, include: lineInclude }),
  ])
  const contractById = new Map<number, any>()
  for (const c of stamped as any[]) contractById.set(c.id, c)
  if (active && !contractById.has(active.id)) contractById.set(active.id, active)

  // ── 3. resolve each line ──────────────────────────────────────────────────
  const byLineId = new Map<number, LineRate>()
  const usedContractIds = new Map<number, 'lot' | 'fallback-active'>()
  let amount = 0, pricedLines = 0, unpricedLines = 0, pricedThan = 0, unpricedThan = 0

  const fail = (line: any, issue: RateIssue, partial?: Partial<LineRate>): LineRate => ({
    rate: null, unit: null, amount: null, contractVersion: null, contractStatus: null,
    processTypeName: null, source: null, issue, ...partial,
  })

  for (const line of challan.lines as any[]) {
    const grey = greyByLot.get(key(line.lotNo))
    let res: LineRate

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
            // as per-than. Show the rate, withhold the amount.
            res = { ...base, rate, unit, amount: null, processTypeName, issue: 'unit-not-than' }
          } else {
            res = { ...base, rate, unit, amount: multiply(line.than, rate), processTypeName }
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
