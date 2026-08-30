export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import BackButton from '../../BackButton'
import { resolveChallanRates, RATE_ISSUE_LABEL } from '@/lib/delivery-challan-rates'

const db = prisma as any

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString('en-IN')

// Internal working view of a delivery challan for ACCOUNTS — shows the process
// rate per lot, the line amount and a grand total, so the job bill can be
// raised from one screen. The customer copy (/delivery/[id]/print + the PDF)
// deliberately carries no rates.
export default async function DeliveryChallanViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const challanId = parseInt(id)
  if (!Number.isFinite(challanId)) notFound()

  const challan = await db.finishDeliveryChallan.findUnique({
    where: { id: challanId },
    include: {
      party: { select: { name: true, gstin: true, address: true, state: true } },
      lines: { orderBy: { id: 'asc' } },
    },
  })
  if (!challan) notFound()

  // Marka + source grey challan per lot — same batched enrichment the print
  // page and the list API use (no FK, so match on lotNo).
  const lotNos = [...new Set(challan.lines.map((l: any) => l.lotNo as string))] as string[]
  const greys = lotNos.length
    ? await db.greyEntry.findMany({
        where: { lotNo: { in: lotNos, mode: 'insensitive' } },
        select: { lotNo: true, marka: true, challanNo: true },
        orderBy: { challanNo: 'asc' },
      })
    : []
  const greyByLot = new Map<string, { marka: string | null; chs: Set<number> }>()
  for (const g of greys as any[]) {
    const k = String(g.lotNo).toLowerCase().trim()
    if (!greyByLot.has(k)) greyByLot.set(k, { marka: null, chs: new Set() })
    const e = greyByLot.get(k)!
    if (g.marka && !e.marka) e.marka = g.marka
    if (g.challanNo != null) e.chs.add(g.challanNo)
  }

  const rates = await resolveChallanRates(challanId)
  const totalThan = challan.lines.reduce((s: number, l: any) => s + l.than, 0)
  const multiVersion = new Set(rates.contractsUsed.map(c => c.version)).size > 1

  return (
    <div className="p-4 md:p-8 max-w-4xl dark:text-gray-100">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <h1 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Challan {challan.challanNo}</h1>
        <span className={`ml-auto text-[10px] px-2 py-0.5 rounded font-semibold ${
          challan.status === 'issued'
            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
          {challan.status}
        </span>
      </div>

      {/* Header card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <div className="text-base font-bold text-gray-800 dark:text-gray-100">{challan.party.name}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-2 text-xs text-gray-600 dark:text-gray-300">
          <div><span className="text-gray-400">Date</span> {fmtDate(challan.date)}</div>
          <div><span className="text-gray-400">Lots</span> {challan.lines.length}</div>
          <div><span className="text-gray-400">Than</span> <span className="font-semibold">{totalThan}</span></div>
          {challan.vehicleNo && <div><span className="text-gray-400">Vehicle</span> {challan.vehicleNo}</div>}
          {challan.destination && <div><span className="text-gray-400">Destination</span> {challan.destination}</div>}
          {challan.transport && <div><span className="text-gray-400">Transport</span> {challan.transport}</div>}
          {challan.lrNo && <div><span className="text-gray-400">LR</span> {challan.lrNo}</div>}
        </div>
        <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2.5 py-1.5">
          Internal working copy for billing — rates are not shown on the customer challan.
        </p>
      </div>

      {/* Version banner — only when the challan spans more than one rate version */}
      {multiVersion && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-indigo-200 dark:border-indigo-800 p-4 mb-4">
          <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 mb-2">
            ⚠ This challan spans {new Set(rates.contractsUsed.map(c => c.version)).size} rate versions — lines are priced at the version each lot is linked to.
          </p>
          <div className="space-y-1.5">
            {rates.contractsUsed.map(c => (
              <div key={c.id} className="text-[11px] text-gray-600 dark:text-gray-300">
                <span className="font-bold text-gray-800 dark:text-gray-100">v{c.version}</span>
                <span className="text-gray-400"> · {c.status} · from {fmtDate(c.effectiveFrom)}</span>
                {c.source === 'fallback-active' && <span className="ml-1 text-amber-600 dark:text-amber-400">(fallback — lot not linked)</span>}
                {c.lines.map((rl, i) => (
                  <span key={i} className="ml-2">
                    {rl.processTypeName}:{' '}
                    {rl.rateMode === 'BY_COLOR_CATEGORY'
                      ? `L ${rl.rateLight ?? '-'} / M ${rl.rateMedium ?? '-'} / D ${rl.rateDark ?? '-'}`
                      : (rl.rate ?? '-')}
                    <span className="text-gray-400"> per {rl.unit}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lines with rate + amount */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-3 sm:p-5 mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                <th className="py-1.5 pr-2 font-semibold">Lot No</th>
                <th className="py-1.5 pr-2 font-semibold">Marka</th>
                <th className="py-1.5 pr-2 font-semibold">Quality</th>
                <th className="py-1.5 pr-2 font-semibold">Shade</th>
                <th className="py-1.5 pl-2 font-semibold text-right">Than</th>
                <th className="py-1.5 pl-2 font-semibold text-right">Rate</th>
                <th className="py-1.5 pl-2 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {challan.lines.map((l: any) => {
                const r = rates.byLineId.get(l.id)
                const info = greyByLot.get(String(l.lotNo).toLowerCase().trim())
                return (
                  <tr key={l.id}>
                    <td className="py-1.5 pr-2 font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">{l.lotNo}</td>
                    <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300">{info?.marka || '-'}</td>
                    <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">{l.qualityName || '-'}</td>
                    <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">
                      {l.shadeName || '-'}
                      {l.shadeCategory && <span className="ml-1 text-[9px] text-gray-400">[{l.shadeCategory}]</span>}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-semibold text-gray-800 dark:text-gray-100">{l.than}</td>
                    <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                      {r?.rate ? (
                        <>
                          <span className="font-semibold text-gray-800 dark:text-gray-100">{r.rate}</span>
                          {r.unit !== 'than' && <span className="text-[9px] text-gray-400">/{r.unit}</span>}
                          {r.contractVersion != null && <span className="ml-1 text-[9px] text-indigo-500 dark:text-indigo-400">v{r.contractVersion}</span>}
                        </>
                      ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                      {r?.amount != null
                        ? <span className="font-bold text-gray-900 dark:text-gray-50">{inr(r.amount)}</span>
                        : <span className="text-[9px] text-rose-500 dark:text-rose-400">{r?.issue ? RATE_ISSUE_LABEL[r.issue] : '—'}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-gray-600 font-bold">
                <td className="py-2 pr-2 text-gray-700 dark:text-gray-200" colSpan={4}>Grand Total</td>
                <td className="py-2 pl-2 text-right text-gray-900 dark:text-gray-50">{totalThan}</td>
                <td />
                <td className="py-2 pl-2 text-right text-emerald-700 dark:text-emerald-400 whitespace-nowrap">{inr(rates.totals.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {rates.totals.unpricedLines > 0 && (
          <p className="mt-3 text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-2.5 py-1.5">
            ⚠ Total is partial — <strong>{rates.totals.unpricedLines}</strong> of {challan.lines.length} line(s)
            ({rates.totals.unpricedThan} than) could not be priced. Fix the lot’s rate link / process type / colour
            category, or add those lines to the bill manually.
          </p>
        )}
      </div>

      {/* Process-rate notes at the end — the agreed terms for this bill */}
      {rates.contractsUsed.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Process rate — terms & notes</p>
          {rates.contractsUsed.map(c => (
            <div key={c.id} className="mb-3 last:mb-0">
              <div className="text-xs font-bold text-gray-700 dark:text-gray-200">
                v{c.version} <span className="font-normal text-gray-400">· {c.status} · effective {fmtDate(c.effectiveFrom)}</span>
                {c.source === 'fallback-active' && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">(used as fallback)</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
                {c.lines.map((rl, i) => (
                  <span key={i}>
                    <span className="text-gray-400">{rl.processTypeName}:</span>{' '}
                    {rl.rateMode === 'BY_COLOR_CATEGORY'
                      ? `Light ${rl.rateLight ?? '-'} · Medium ${rl.rateMedium ?? '-'} · Dark ${rl.rateDark ?? '-'}`
                      : (rl.rate ?? '-')}
                    <span className="text-gray-400"> per {rl.unit}</span>
                  </span>
                ))}
              </div>
              {c.notes && (
                <p className="mt-1.5 text-[12px] text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg px-3 py-2">
                  📝 {c.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href={`/delivery/${challanId}/print`} target="_blank"
          className="text-sm font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700 rounded-lg px-4 py-2">
          Print customer copy
        </Link>
        <Link href="/delivery"
          className="text-sm font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2">
          Back to Delivery Challan
        </Link>
      </div>
    </div>
  )
}
