// Evaluates a contract's ProcessRateRule list against one challan line's
// context. Pure — no I/O — so the brackets that decide real money are
// unit-testable.
//
// Trigger kinds:
//   auto   — every non-null condition must match. A null CONTEXT value never
//            matches a non-null condition: a missing machine or unknown batch
//            size simply doesn't fire the rule (decided: no tag, base rate).
//   lr     — fires when the line snapshots a real LR. Same predicate as the
//            DC print's Checking chip: non-blank and not literally "open".
//   manual — fires when accounts ticked it (ChallanLineRuleTick row).
//
// All firing rules STACK: amounts sum onto the per-than rate. The batch-size
// brackets exclude each other via their own min/max ranges.

export type RateRule = {
  id: number
  processTypeId: number | null   // null = applies to every line in the contract
  trigger: string                // auto | lr | manual
  minThan: number | null
  maxThan: number | null
  widthInch: number | null
  machineNumber: number | null
  amountPerThan: string | number // Decimal over the wire
  label: string
  active: boolean
}

export type RuleContext = {
  processTypeId: number
  batchThan: number | null       // whole dyeing-batch total (all lots in the slip)
  widthInch: number | null       // Quality.widthInch via the lot's grey entry
  machineNumber: number | null   // DyeingMachine.number of the slip's machine
  hasRealLr: boolean
  tickedRuleIds: ReadonlySet<number>
}

export type AppliedRule = {
  ruleId: number
  label: string
  amountPerThan: number
  trigger: string
}

/** The DC print's Checking-chip predicate, reused verbatim for `lr` rules. */
export function isRealLr(lrNo: string | null | undefined): boolean {
  const v = String(lrNo ?? '').trim()
  return v !== '' && v.toLowerCase() !== 'open'
}

export function applyRules(rules: RateRule[], ctx: RuleContext): AppliedRule[] {
  const out: AppliedRule[] = []
  for (const r of rules) {
    if (!r.active) continue
    if (r.processTypeId != null && r.processTypeId !== ctx.processTypeId) continue

    let fires = false
    if (r.trigger === 'manual') {
      fires = ctx.tickedRuleIds.has(r.id)
    } else if (r.trigger === 'lr') {
      fires = ctx.hasRealLr
    } else {
      // auto: AND every non-null condition; null context never matches.
      fires = true
      if (r.minThan != null) fires = fires && ctx.batchThan != null && ctx.batchThan >= r.minThan
      if (r.maxThan != null) fires = fires && ctx.batchThan != null && ctx.batchThan <= r.maxThan
      if (r.widthInch != null) fires = fires && ctx.widthInch != null && ctx.widthInch === r.widthInch
      if (r.machineNumber != null) fires = fires && ctx.machineNumber != null && ctx.machineNumber === r.machineNumber
      // An auto rule with no conditions at all would fire on everything —
      // treat that as a misconfiguration and skip it.
      if (r.minThan == null && r.maxThan == null && r.widthInch == null && r.machineNumber == null) fires = false
    }

    if (fires) {
      out.push({ ruleId: r.id, label: r.label, amountPerThan: Number(r.amountPerThan), trigger: r.trigger })
    }
  }
  return out
}

/** Sum of the applied per-than adjustments, in paise (integer-safe). */
export function adjustmentPaise(applied: AppliedRule[]): number {
  return applied.reduce((s, a) => s + Math.round(a.amountPerThan * 100), 0)
}
