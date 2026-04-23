import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { buildLotInfoMap } from '@/lib/lot-info'
import Link from 'next/link'
import BackButton from '../../BackButton'

export default async function FinishDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = prisma as any

  const entry = await db.finishEntry.findUnique({
    where: { id: parseInt(id) },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
      additions: { include: { chemicals: true }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!entry) notFound()

  const lots = entry.lots?.length ? entry.lots : [{ id: 0, lotNo: entry.lotNo, than: entry.than, meter: null, doneThan: 0, status: 'pending' }]
  const lotNos = lots.map((l: any) => l.lotNo)
  const totalThan = lots.reduce((s: number, l: any) => s + l.than, 0)
  const totalDoneThan = lots.reduce((s: number, l: any) => s + (l.status === 'done' ? l.than : l.status === 'partial' ? (l.doneThan || 0) : 0), 0)

  const lotInfoMap = await buildLotInfoMap(lotNos)
  const partyNames = [...new Set(Array.from(lotInfoMap.values()).map(v => v.party).filter(Boolean))]
  const qualityNames = [...new Set(Array.from(lotInfoMap.values()).map(v => v.quality).filter(Boolean))]

  // Dyeing info per lot
  const dyeingEntries = await db.dyeingEntry.findMany({
    where: { OR: [{ lotNo: { in: lotNos } }, { lots: { some: { lotNo: { in: lotNos } } } }] },
    select: {
      slipNo: true, shadeName: true,
      lots: { select: { lotNo: true } },
      foldBatch: { select: { foldProgram: { select: { foldNo: true } }, shade: { select: { name: true, description: true } } } },
    },
  })

  const dyeByLot = new Map<string, { slipNo: number; shadeName: string | null; shadeDesc: string | null; foldNo: string | null }>()
  for (const de of dyeingEntries) {
    const foldNo = de.foldBatch?.foldProgram?.foldNo || null
    const shade = de.shadeName || de.foldBatch?.shade?.name || null
    const shadeDesc = de.foldBatch?.shade?.description || null
    for (const dl of (de.lots?.length ? de.lots : [])) {
      if (!dyeByLot.has(dl.lotNo)) dyeByLot.set(dl.lotNo, { slipNo: de.slipNo, shadeName: shade, shadeDesc, foldNo })
    }
  }

  // Group lots: fold → slip
  const foldMap = new Map<string, Map<number, { shade: string; lots: any[] }>>()
  for (const lot of lots) {
    const dye = dyeByLot.get(lot.lotNo)
    const foldNo = dye?.foldNo || 'No Fold'
    const slipNo = dye?.slipNo || 0
    const shade = [dye?.shadeName, dye?.shadeDesc].filter(Boolean).join(' — ')
    if (!foldMap.has(foldNo)) foldMap.set(foldNo, new Map())
    const sMap = foldMap.get(foldNo)!
    if (!sMap.has(slipNo)) sMap.set(slipNo, { shade, lots: [] })
    sMap.get(slipNo)!.lots.push(lot)
  }

  const chemicals = (entry.chemicals || []).map((c: any) => ({
    name: c.name || c.chemical?.name || '', quantity: c.quantity, unit: c.unit, rate: c.rate, cost: c.cost,
  }))

  // Consumption
  const op = entry.opMandi || 0
  const nw = entry.newMandi || 0
  const st = entry.stockMandi || 0
  const consumed = op + nw - st

  const addQtyMap = new Map<string, number>()
  for (const add of (entry.additions || [])) {
    for (const c of (add.chemicals || [])) {
      if (c.quantity) addQtyMap.set(c.name.toLowerCase().trim(), (addQtyMap.get(c.name.toLowerCase().trim()) || 0) + c.quantity)
    }
  }

  const chemUsage = chemicals.map((c: any) => {
    const recipeQty = c.quantity || 0
    const rate = c.rate || 0
    const mandiUsed = consumed > 0 ? (recipeQty / 100) * consumed : 0
    const addQty = addQtyMap.get(c.name.toLowerCase().trim()) || 0
    const usedQty = mandiUsed + addQty
    const cost = usedQty * rate
    return { name: c.name, recipeQty, unit: c.unit, rate, mandiUsed, addQty, usedQty, cost }
  })

  const totalCost = chemUsage.reduce((s: number, c: any) => s + c.cost, 0)
  const costPerLtr = consumed > 0 ? totalCost / consumed : 0
  const thanForCalc = totalDoneThan || totalThan
  const costPerThan = thanForCalc > 0 ? totalCost / thanForCalc : 0
  const totalMeter = entry.meter || 0
  const costPerMtr = totalMeter > 0 ? totalCost / totalMeter : 0
  const ltrPerThan = thanForCalc > 0 ? consumed / thanForCalc : 0

  const dateStr = new Date(entry.date).toLocaleDateString('en-IN')
  const allDone = lots.every((l: any) => l.status === 'done')
  const anyDone = lots.some((l: any) => l.status === 'done' || l.status === 'partial')
  const fpStatus = allDone ? 'Finished' : anyDone ? 'Partial' : 'Pending'
  const statusCls = allDone ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800'
    : anyDone ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
    : 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'

  return (
    <div className="p-4 md:p-8 max-w-2xl dark:text-gray-100">
      <div className="flex items-center gap-4 mb-6">
        <BackButton />
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Finish_Prg #{entry.slipNo}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{dateStr}</p>
        </div>
        <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full border ml-auto ${statusCls}`}>{fpStatus}</span>
      </div>

      {/* Finish Desp Slip No — highlighted */}
      {entry.finishDespSlipNo && (
        <div className="bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
          <span className="text-xs font-bold text-purple-700 dark:text-purple-300">Finish Desp Slip No:</span>
          <span className="text-base font-bold text-purple-800 dark:text-purple-200">{entry.finishDespSlipNo}</span>
        </div>
      )}

      {/* Info */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-gray-400">Party</p><p className="font-medium">{partyNames.join(', ') || '—'}</p></div>
          <div><p className="text-xs text-gray-400">Quality</p><p className="font-medium">{qualityNames.join(', ') || '—'}</p></div>
          <div><p className="text-xs text-gray-400">Total Than</p><p className="font-bold text-emerald-600 dark:text-emerald-400">{totalThan}</p></div>
          <div><p className="text-xs text-gray-400">Done Than</p><p className="font-bold text-teal-600 dark:text-teal-400">{totalDoneThan}</p></div>
          {entry.finishThan != null && <div><p className="text-xs text-gray-400">Finish Than</p><p className="font-bold text-indigo-600 dark:text-indigo-400">{entry.finishThan}</p></div>}
          {entry.finishMtr != null && <div><p className="text-xs text-gray-400">Finish Mtr</p><p className="font-bold text-indigo-600 dark:text-indigo-400">{entry.finishMtr}</p></div>}
          {totalMeter > 0 && <div><p className="text-xs text-gray-400">Total Meter</p><p className="font-medium">{totalMeter}</p></div>}
        </div>
      </div>

      {/* Fold → Slip → Lots */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Lots</h2>
        {Array.from(foldMap.entries()).map(([foldNo, slipMap]) => (
          <div key={foldNo} className="mb-3">
            <div className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 mb-1">📁 Fold {foldNo}</div>
            {Array.from(slipMap.entries()).map(([slipNo, { shade, lots: sLots }]) => (
              <div key={slipNo} className="ml-3 mb-2">
                {slipNo > 0 && <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Slip {slipNo}{shade ? ` — ${shade}` : ''}</p>}
                <div className="space-y-1">
                  {sLots.map((lot: any) => {
                    const bg = lot.status === 'done' ? 'bg-green-50 dark:bg-green-900/20' : lot.status === 'partial' ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-gray-50 dark:bg-gray-900/50'
                    return (
                      <div key={lot.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${bg}`}>
                        <Link href={`/lot/${encodeURIComponent(lot.lotNo)}`} className="text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline">{lot.lotNo}</Link>
                        <span className="text-xs text-gray-600 dark:text-gray-400">{lot.than}T</span>
                        {lot.status === 'done' && <span className="text-[10px] text-green-600 dark:text-green-400 ml-auto">✅ Done</span>}
                        {lot.status === 'partial' && <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-auto">🟡 {lot.doneThan}T done</span>}
                        {lot.status === 'pending' && <span className="text-[10px] text-gray-400 ml-auto">⏳ Pending</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 100 Ltr Recipe */}
      {chemicals.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Chemicals (per 100 Litres)</h2>
          <div className="space-y-1.5">
            {chemicals.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2">
                <span className="text-sm text-gray-800 dark:text-gray-100">{c.name}</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{c.quantity != null ? Number(c.quantity).toFixed(1) : '—'} {c.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Additions */}
      {entry.additions?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Additions ({entry.additions.length})</h2>
          <div className="space-y-3">
            {entry.additions.map((add: any, ai: number) => (
              <div key={add.id} className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-900/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">Addition #{ai + 1}</span>
                  {add.reason && <span className="text-[10px] text-gray-500 italic">{add.reason}</span>}
                </div>
                <div className="space-y-1">
                  {add.chemicals.filter((c: any) => c.quantity > 0).map((c: any, ci: number) => (
                    <div key={ci} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-300">{c.name}</span>
                      <span className="text-amber-600 dark:text-amber-400 font-medium">+{Number(c.quantity).toFixed(2)} {c.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mandi Status */}
      {(op > 0 || nw > 0 || st > 0) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Mandi Status</h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="text-center bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase">Op Mandi</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{op} ltr</p>
            </div>
            <div className="text-center bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase">New Mandi</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400">{nw} ltr</p>
            </div>
            <div className="text-center bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase">Stock Mandi</p>
              <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{st} ltr</p>
            </div>
          </div>
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">Consumed Mandi</span>
              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{consumed.toFixed(1)} ltr</span>
            </div>
          </div>
        </div>
      )}

      {/* Chemical Consumed */}
      {chemUsage.length > 0 && (consumed > 0 || addQtyMap.size > 0) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Chemical Consumed</h2>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-2 py-1.5 font-semibold">Chemical</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Qty</th>
                  {addQtyMap.size > 0 && <th className="text-right px-2 py-1.5 font-semibold text-amber-600">+Add</th>}
                  <th className="text-right px-2 py-1.5 font-semibold">Total</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Rate</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {chemUsage.map((c: any, i: number) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5 text-gray-700 dark:text-gray-200">{c.name}</td>
                    <td className="px-2 py-1.5 text-right text-gray-500">{c.mandiUsed.toFixed(2)}</td>
                    {addQtyMap.size > 0 && <td className="px-2 py-1.5 text-right text-amber-600">{c.addQty > 0 ? `+${c.addQty.toFixed(2)}` : '-'}</td>}
                    <td className="px-2 py-1.5 text-right font-medium">{c.usedQty.toFixed(2)} {c.unit}</td>
                    <td className="px-2 py-1.5 text-right text-gray-500">{c.rate > 0 ? `₹${c.rate}` : '-'}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400 font-medium">₹{c.cost.toFixed(0)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 dark:bg-gray-700/50 font-bold">
                  <td className="px-2 py-2 text-gray-700 dark:text-gray-200" colSpan={addQtyMap.size > 0 ? 5 : 4}>Total</td>
                  <td className="px-2 py-2 text-right text-emerald-600 dark:text-emerald-400">₹{totalCost.toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Consumption Report */}
      {(consumed > 0 || totalCost > 0) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Consumption Report</h2>
          <div className="grid grid-cols-2 gap-3">
            {ltrPerThan > 0 && (
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-4 py-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase">Consumption</p>
                <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{ltrPerThan.toFixed(2)}</p>
                <p className="text-[10px] text-gray-400">ltr / than</p>
              </div>
            )}
            {costPerLtr > 0 && (
              <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase">Cost / Litre</p>
                <p className="text-lg font-bold text-gray-700 dark:text-gray-200">₹{costPerLtr.toFixed(2)}</p>
                <p className="text-[10px] text-gray-400">per ltr</p>
              </div>
            )}
            {costPerThan > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase">Cost / Than</p>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">₹{costPerThan.toFixed(2)}</p>
                <p className="text-[10px] text-gray-400">{thanForCalc}T</p>
              </div>
            )}
            {costPerMtr > 0 && (
              <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg px-4 py-3 text-center">
                <p className="text-[10px] text-gray-500 uppercase">Cost / Meter</p>
                <p className="text-lg font-bold text-teal-600 dark:text-teal-400">₹{costPerMtr.toFixed(2)}</p>
                <p className="text-[10px] text-gray-400">{totalMeter}m</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notes */}
      {entry.notes && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Notes</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{entry.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 mt-4">
        <Link href={`/finish/${id}/print`} target="_blank" className="text-sm font-medium text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-700 rounded-lg px-4 py-2">Print</Link>
        <Link href="/finish" className="text-sm font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2">Back to Finish</Link>
      </div>
    </div>
  )
}
