'use client'

// The billing table: clubs challan-line slices into one row per
// (lot, effective rate, contract version), expandable to show each slice's
// dye slip, shade, batch size and the rule tags that fired. Manual contract
// rules render as tick checkboxes; ticks persist via
// /api/delivery-challan/[id]/rule-ticks and the page refreshes to re-price.
//
// Totals are NOT computed here — the server page derives them from the flat
// line list (grouping-invariant) and passes them in.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export type SliceView = {
  lineId: number
  lotNo: string
  marka: string | null
  qualityName: string | null
  shadeName: string | null
  shadeCategory: string | null
  than: number
  rate: string | null           // effective
  baseRate: string | null
  applied: Array<{ ruleId: number; label: string; amountPerThan: number; trigger: string }>
  amount: number | null
  contractVersion: number | null
  /** 'lot' = priced at the version the lot is linked to; 'fallback-active' =
      the lot has NO contract link and priced at the party's current active
      version. The row must show the difference — a fallback v2 chip that
      looks like a real link sends accounts hunting for a link that
      doesn't exist. */
  rateSource: 'lot' | 'fallback-active' | null
  dyeSlipNo: number | null
  batchThan: number | null
  machineNumber: number | null
  issueLabel: string | null     // RATE_ISSUE_LABEL[issue] resolved server-side
}
export type ManualRule = { id: number; label: string; amountPerThan: number; contractVersion: number }

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Club = {
  key: string
  lotNo: string; marka: string | null; qualityName: string | null
  than: number
  rate: string | null; contractVersion: number | null
  rateSource: 'lot' | 'fallback-active' | null
  // Base rate chip — shown only when every slice in the club shares the same
  // base AND rules changed it (mixed bases inside one club would make a
  // single base chip a lie, so it is dropped in that rare case).
  baseRate: string | null
  applied: SliceView['applied']
  amount: number | null         // null when any slice is unpriced
  issueLabel: string | null
  slices: SliceView[]
}

export default function BillLines({ challanId, slices, manualRules, totalThan, totalAmount, unpricedSlices, unpricedThan }: {
  challanId: number
  slices: SliceView[]
  manualRules: ManualRule[]
  totalThan: number
  totalAmount: number
  unpricedSlices: number
  unpricedThan: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busyRule, setBusyRule] = useState<string | null>(null)

  const clubs = useMemo<Club[]>(() => {
    const m = new Map<string, Club>()
    for (const s of slices) {
      // Same-rate same-version slices of a lot club together; a different
      // effective rate (shade category / rule outcome) stays its own row so
      // Amount = Than × Rate holds on every visible row.
      const k = `${s.lotNo.toLowerCase().trim()}||${s.rate ?? 'x'}||${s.contractVersion ?? 'x'}||${s.issueLabel ?? ''}`
      const cur = m.get(k)
      if (cur) {
        cur.than += s.than
        if (s.amount != null && cur.amount != null) cur.amount += s.amount
        else cur.amount = null
        if (cur.baseRate !== (s.baseRate ?? null)) cur.baseRate = null
        // If ANY slice in the club is unlinked, the whole row warns.
        if ((s.rateSource ?? null) === 'fallback-active') cur.rateSource = 'fallback-active'
        cur.slices.push(s)
      } else {
        m.set(k, {
          key: k, lotNo: s.lotNo, marka: s.marka, qualityName: s.qualityName,
          than: s.than, rate: s.rate, contractVersion: s.contractVersion,
          rateSource: s.rateSource ?? null,
          baseRate: s.baseRate ?? null,
          applied: s.applied, amount: s.amount, issueLabel: s.issueLabel,
          slices: [s],
        })
      }
    }
    return [...m.values()].sort((a, b) => a.lotNo.localeCompare(b.lotNo) || (Number(a.rate) || 0) - (Number(b.rate) || 0))
  }, [slices])

  const toggle = (k: string) => setOpen(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  async function tick(club: Club, rule: ManualRule, on: boolean) {
    const busyKey = `${club.key}:${rule.id}`
    setBusyRule(busyKey)
    try {
      const res = await fetch(`/api/delivery-challan/${challanId}/rule-ticks`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineIds: club.slices.map(s => s.lineId), ruleId: rule.id, on }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as any))
        alert(d.message || d.error || `HTTP ${res.status}`)
        return
      }
      router.refresh()   // server re-resolves rates; totals move together
    } finally { setBusyRule(null) }
  }

  const chip = (a: { label: string; amountPerThan: number }, i: number) => (
    <span key={i} title={a.label}
      className={`text-[9px] font-bold rounded px-1 py-0.5 whitespace-nowrap ${a.amountPerThan < 0
        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
        : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
      {a.amountPerThan > 0 ? '+' : ''}{a.amountPerThan}
    </span>
  )

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3 sm:p-5 mb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
              <th className="py-1.5 pr-2 font-semibold w-4"></th>
              <th className="py-1.5 pr-2 font-semibold">Lot No</th>
              <th className="py-1.5 pr-2 font-semibold">Marka</th>
              <th className="py-1.5 pr-2 font-semibold">Quality</th>
              <th className="py-1.5 pl-2 font-semibold text-right">Than</th>
              <th className="py-1.5 pl-2 font-semibold text-right">Rate</th>
              <th className="py-1.5 pl-2 font-semibold text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
            {clubs.map(c => {
              const isOpen = open.has(c.key)
              return [
                <tr key={c.key} onClick={() => toggle(c.key)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="py-1.5 pr-1 text-gray-400 text-[10px]">
                    <span className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">
                    {c.lotNo}
                    {c.slices.length > 1 && <span className="ml-1 text-[9px] text-gray-400">×{c.slices.length}</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300">{c.marka || '-'}</td>
                  <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">{c.qualityName || '-'}</td>
                  <td className="py-1.5 pl-2 text-right font-semibold text-gray-800 dark:text-gray-100">{c.than}</td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    {c.rate ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="font-semibold text-gray-800 dark:text-gray-100">{Number(c.rate).toLocaleString('en-IN')}</span>
                        {c.contractVersion != null && (
                          c.rateSource === 'fallback-active' ? (
                            <span title="This lot is NOT linked to any rate contract — priced at the party's current active version as a fallback. Link the lot on the rate register to pin its version."
                              className="text-[9px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded px-1 py-0.5 whitespace-nowrap">
                              v{c.contractVersion} ⚠ not linked
                            </span>
                          ) : (
                            <span className="text-[9px] text-indigo-500 dark:text-indigo-400">v{c.contractVersion}</span>
                          )
                        )}
                        {/* Base rate first, then the adjustments that moved it —
                            reads as the math story: base 380 · +10 · −25 → 365 */}
                        {c.applied.length > 0 && c.baseRate != null && c.baseRate !== c.rate && (
                          <span title={`Contract base rate ${Number(c.baseRate).toLocaleString('en-IN')}/than before rule adjustments`}
                            className="text-[9px] font-bold rounded px-1 py-0.5 whitespace-nowrap bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            base {Number(c.baseRate).toLocaleString('en-IN')}
                          </span>
                        )}
                        {c.applied.map(chip)}
                      </span>
                    ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    {c.amount != null
                      ? <span className="font-bold text-gray-900 dark:text-gray-50">{inr(c.amount)}</span>
                      : <span className="text-[9px] text-rose-500 dark:text-rose-400">{c.issueLabel ?? '—'}</span>}
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${c.key}-x`}>
                    <td></td>
                    <td colSpan={6} className="pb-2">
                      <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 px-3 py-2 space-y-1.5">
                        {c.slices.map(s => (
                          <div key={s.lineId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                            <span className="font-semibold text-purple-600 dark:text-purple-400 whitespace-nowrap">
                              {s.dyeSlipNo != null ? `Dye ${s.dyeSlipNo}` : 'no dye slip'}
                            </span>
                            <span className="text-gray-600 dark:text-gray-300 truncate max-w-[10rem]">
                              {s.shadeName || '-'}{s.shadeCategory && <span className="text-[9px] text-gray-400"> [{s.shadeCategory}]</span>}
                            </span>
                            <span className="text-gray-700 dark:text-gray-200 font-semibold whitespace-nowrap">{s.than} than</span>
                            {s.batchThan != null && (
                              <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                batch {s.batchThan}{s.machineNumber != null && ` · Jet ${s.machineNumber}`}
                              </span>
                            )}
                            <span className="flex items-center gap-1 flex-wrap">
                              {/* Base first, then what moved it */}
                              {s.baseRate && s.rate !== s.baseRate && (
                                <span className="text-[9px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  base ₹{Number(s.baseRate).toLocaleString('en-IN')}
                                </span>
                              )}
                              {s.applied.map((a, i) => (
                                <span key={i} className={`text-[9px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${a.amountPerThan < 0
                                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                                  {a.amountPerThan < 0 ? '🟢' : '🟡'} {a.label} {a.amountPerThan > 0 ? '+' : ''}₹{a.amountPerThan}
                                </span>
                              ))}
                            </span>
                          </div>
                        ))}

                        {/* Manual contract charges — tick what applied */}
                        {manualRules.length > 0 && c.amount != null && (
                          <div className="pt-1.5 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-3">
                            <span className="text-[10px] uppercase tracking-wide text-gray-400">Manual charges</span>
                            {manualRules.map(r => {
                              const onCount = c.slices.filter(s => s.applied.some(a => a.ruleId === r.id)).length
                              const allOn = onCount === c.slices.length
                              const busy = busyRule === `${c.key}:${r.id}`
                              return (
                                <label key={r.id} className="flex items-center gap-1.5 text-[11px] text-gray-700 dark:text-gray-200 cursor-pointer">
                                  <input type="checkbox" checked={allOn}
                                    ref={el => { if (el) el.indeterminate = onCount > 0 && !allOn }}
                                    disabled={busy}
                                    onChange={() => tick(c, r, !allOn)}
                                    className="accent-amber-600" />
                                  {r.label} <span className="text-amber-700 dark:text-amber-400 font-semibold">+₹{r.amountPerThan}/than</span>
                                  {busy && <span className="text-gray-400">…</span>}
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 dark:border-gray-600 font-bold">
              <td className="py-2 pr-2 text-gray-700 dark:text-gray-200" colSpan={4}>Grand Total</td>
              <td className="py-2 pl-2 text-right text-gray-900 dark:text-gray-50">{totalThan}</td>
              <td />
              <td className="py-2 pl-2 text-right text-emerald-700 dark:text-emerald-400 whitespace-nowrap">{inr(totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {unpricedSlices > 0 && (
        <p className="mt-3 text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-2.5 py-1.5">
          ⚠ Total is partial — <strong>{unpricedSlices}</strong> lot-slice(s) ({unpricedThan} than) could not be
          priced. Fix the lot’s rate link / process type / colour category, or add those lines to the bill manually.
        </p>
      )}
    </div>
  )
}
