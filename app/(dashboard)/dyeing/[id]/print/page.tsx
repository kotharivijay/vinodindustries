import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import PrintTrigger, { PrintButton } from './PrintTrigger'
import PrintSettings from './PrintSettings'
import BluetoothPrint from './BluetoothPrint'
import ReceiptPrint from './ReceiptPrint'
import SharePDFButton from './SharePDFButton'

export default async function DyeingPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ round?: string }> }) {
  const { id } = await params
  const { round: roundParam } = await searchParams
  const db = prisma as any

  const entry = await db.dyeingEntry.findUnique({
    where: { id: parseInt(id) },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
      machine: true,
      operator: true,
      additions: {
        include: {
          chemicals: { include: { chemical: true } },
          machine: true,
          operator: true,
        },
        orderBy: { roundNo: 'asc' },
      },
    },
  })

  if (!entry) notFound()

  // Enrich with party name + quality (GreyEntry + carry-forward fallback)
  const lotNos = entry.lots?.length ? entry.lots.map((l: any) => l.lotNo) : [entry.lotNo]
  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotInfoMap = await buildLotInfoMap(lotNos)
  const lotInfos = Array.from(lotInfoMap.values())
  const partyNames = [...new Set(lotInfos.map(v => v.party).filter(Boolean))]
  const partyName = partyNames.join(', ') || null
  const qualityNames = [...new Set(lotInfos.map(v => v.quality).filter(Boolean))]
  const qualityName = qualityNames.join(', ') || null

  // Build per-lot marka map
  const lotMarkaMap = new Map<string, string>()
  for (const [key, info] of lotInfoMap) {
    if (info.marka) lotMarkaMap.set(key, info.marka)
  }
  const entryMarka = entry.marka || lotInfos.find(li => li.marka)?.marka || null

  // Get shade description
  let shadeDescription: string | null = null
  if (entry.shadeName) {
    const shade = await db.shade.findFirst({ where: { name: entry.shadeName }, select: { description: true } })
    shadeDescription = shade?.description || null
  }

  const lots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo, than: entry.than }]
  const totalThan = lots.reduce((s: number, l: any) => s + l.than, 0)

  const isReDyed = (entry.additions?.length ?? 0) > 0
  const totalRounds = entry.totalRounds ?? 1

  // Determine what to show based on ?round param
  const showRound = roundParam ? (roundParam === 'all' ? 'all' : parseInt(roundParam)) : 1
  const showingSpecificRound = typeof showRound === 'number' && showRound > 1

  // Group chemicals by processTag for Round 1
  const chemicals = entry.chemicals || []
  const grouped: Record<string, typeof chemicals> = {}
  for (const c of chemicals) {
    const tag = c.processTag || '_other'
    if (!grouped[tag]) grouped[tag] = []
    grouped[tag].push(c)
  }
  const tagOrder = Object.keys(grouped).sort((a, b) => {
    if (a === 'shade') return -1
    if (b === 'shade') return 1
    if (a === '_other') return 1
    if (b === '_other') return -1
    return a.localeCompare(b)
  })

  // Get specific addition if showing a specific round > 1
  const specificAddition = showingSpecificRound
    ? (entry.additions || []).find((a: any) => a.roundNo === showRound)
    : null

  // Calculate total costs
  const round1Cost = chemicals.reduce((s: number, c: any) => s + (c.cost ?? 0), 0)
  const allAdditionsCost = (entry.additions || []).reduce((s: number, a: any) =>
    s + (a.chemicals?.reduce((s2: number, c: any) => s2 + (c.cost ?? 0), 0) ?? 0), 0)
  const actualTotalCost = round1Cost + allAdditionsCost

  return (
    <div className="print-page bg-white text-black min-h-screen">
      <PrintTrigger />
      <PrintSettings />

      <style>{`
        :root {
          --print-header: 18px;
          --print-lot: 14px;
          --print-label: 13px;
          --print-chem: 12px;
        }
        @media print {
          body { margin: 0; padding: 0; }
          .print-page { padding: 10mm; }
          .no-print { display: none !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
        @media screen {
          .print-page { max-width: 800px; margin: 0 auto; padding: 24px; }
        }
        .print-header { font-size: var(--print-header) !important; }
        .print-lot { font-size: var(--print-lot) !important; }
        .print-label { font-size: var(--print-label) !important; }
        .print-chem { font-size: var(--print-chem) !important; }
        .print-info { font-size: var(--print-chem) !important; }
      `}</style>

      {/* Header */}
      <div className="text-center border-b-2 border-black pb-3 mb-4">
        <h1 data-print="header" className="text-xl font-bold tracking-wide">KOTHARI SYNTHETIC INDUSTRIES</h1>
        <p data-print="label" className="text-sm text-gray-600">
          {showingSpecificRound ? `Re-Dye Slip (Round ${showRound})` : showRound === 'all' ? 'Dyeing Report (All Rounds)' : entry.isPcJob ? 'PC Dyeing Slip' : 'Dyeing Slip'}
        </p>
        {isReDyed && !showingSpecificRound && showRound !== 'all' && (
          <p className="text-xs text-red-600 font-medium mt-1">RE-DYED ({totalRounds} rounds)</p>
        )}
      </div>

      {/* Slip Info Grid */}
      <div data-print="info" className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm mb-4 border border-gray-300 rounded p-3">
        <div className="flex gap-2">
          <span className="font-semibold w-24">Slip No:</span>
          <span>{entry.slipNo}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Date:</span>
          <span>{new Date(entry.date).toLocaleDateString('en-IN')}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Party:</span>
          <span>{partyName || '\u2014'}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Shade:</span>
          <span>{entry.shadeName || '\u2014'}{shadeDescription ? ` \u2014 ${shadeDescription}` : ''}</span>
        </div>
        {qualityName && (
          <div className="flex gap-2">
            <span className="font-semibold w-24">Quality:</span>
            <span>{qualityName}</span>
          </div>
        )}
        {entryMarka && (
          <div className="flex gap-2">
            <span className="font-semibold w-24">Marka:</span>
            <span>{entryMarka}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="font-semibold w-24">Machine:</span>
          <span>{showingSpecificRound && specificAddition?.machine ? specificAddition.machine.name : (entry.machine?.name || '\u2014')}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Operator:</span>
          <span>{showingSpecificRound && specificAddition?.operator ? specificAddition.operator.name : (entry.operator?.name || '\u2014')}</span>
        </div>
        {showingSpecificRound && specificAddition?.defectType && (
          <div className="flex gap-2 col-span-2">
            <span className="font-semibold w-24">Defect:</span>
            <span className="capitalize text-red-600">{specificAddition.defectType}</span>
            {specificAddition.reason && <span className="text-gray-500 ml-2">({specificAddition.reason})</span>}
          </div>
        )}
      </div>

      {/* Lots */}
      <div data-print="lot" className="text-sm mb-4">
        <span data-print-bold="lot" className="font-bold">Lots: </span>
        {lots.map((l: any, i: number) => {
          const lotMarka = lotMarkaMap.get(l.lotNo.toLowerCase().trim())
          return (
            <span key={i} data-print-bold="lot" className="font-bold">
              {l.lotNo}{lotMarka ? ` [${lotMarka}]` : ''} <span className="font-normal">({l.than} than)</span>{i < lots.length - 1 ? ', ' : ''}
            </span>
          )
        })}
        {lots.length > 1 && (
          <span data-print-bold="lot" className="ml-2 font-bold">Total: {totalThan} than</span>
        )}
      </div>

      {/* ── Show based on round param ── */}

      {/* Default / Round 1 */}
      {(showRound === 1 || showRound === 'all') && (
        <>
          {showRound === 'all' && <h3 className="text-sm font-bold border-b border-gray-400 pb-1 mb-3">ROUND 1 (Original)</h3>}
          {tagOrder.map(tag => {
            const tagChems = grouped[tag]
            const isDye = tag === 'shade'
            const label = isDye ? 'Dyes (grams)' : tag === '_other' ? 'Other (kg)' : tag + ' (kg)'
            return (
              <div key={tag} className="mb-4">
                <h3 data-print="label" className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 pb-1 mb-2">
                  {label}
                </h3>
                <table data-print="chem" className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-1 font-semibold w-8">#</th>
                      <th className="text-left py-1 font-semibold">Chemical</th>
                      <th className="text-right py-1 font-semibold w-24">Quantity</th>
                      <th className="text-left py-1 font-semibold w-16 pl-2">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tagChems.map((c: any, i: number) => {
                      let qty: string = '\u2014'
                      let unit = c.unit
                      if (c.quantity != null) {
                        if (isDye) {
                          const grams = Math.round(c.quantity * 1000)
                          qty = String(grams).padStart(4, '0')
                          unit = 'gm'
                        } else {
                          qty = Number(c.quantity).toFixed(1)
                          unit = 'kg'
                        }
                      }
                      return (
                      <tr key={c.id} className="border-b border-gray-200">
                        <td className="py-1 text-gray-500">{i + 1}</td>
                        <td data-print-bold="chem-name" className="py-1 font-medium">{c.name}</td>
                        <td data-print-bold="quantity" className="py-1 text-right font-bold">{qty}</td>
                        <td className="py-1 pl-2 text-gray-600">{unit}</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            )
          })}
          {chemicals.length === 0 && (
            <p className="text-sm text-gray-500 italic my-4">No chemicals recorded.</p>
          )}
        </>
      )}

      {/* Specific round > 1 (re-dye slip) */}
      {showingSpecificRound && specificAddition && (
        <div className="mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 pb-1 mb-2">
            Re-Dye Chemicals (Round {showRound})
          </h3>
          {specificAddition.chemicals?.length > 0 ? (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-1 font-semibold w-8">#</th>
                  <th className="text-left py-1 font-semibold">Chemical</th>
                  <th className="text-right py-1 font-semibold w-24">Quantity</th>
                  <th className="text-left py-1 font-semibold w-16 pl-2">Unit</th>
                </tr>
              </thead>
              <tbody>
                {specificAddition.chemicals.map((c: any, i: number) => (
                  <tr key={c.id} className="border-b border-gray-200">
                    <td className="py-1 text-gray-500">{i + 1}</td>
                    <td className="py-1">{c.name}</td>
                    <td className="py-1 text-right">{c.quantity != null ? c.quantity : '\u2014'}</td>
                    <td className="py-1 pl-2 text-gray-600">{c.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-500 italic">No chemicals for this round.</p>
          )}
        </div>
      )}

      {/* All rounds (additions) */}
      {showRound === 'all' && (entry.additions || []).map((a: any) => {
        const addChems = a.chemicals || []
        return (
          <div key={a.id} className="mb-4">
            <h3 className="text-sm font-bold border-b border-gray-400 pb-1 mb-2">
              ROUND {a.roundNo} ({a.type === 're-dye' ? 'Re-Dye' : 'Addition'})
              {a.defectType ? ` - ${a.defectType}` : ''}
            </h3>
            {a.reason && <p className="text-xs text-gray-500 mb-2">Reason: {a.reason}</p>}
            {(a.machine || a.operator) && (
              <p className="text-xs text-gray-500 mb-2">
                {a.machine ? `Machine: ${a.machine.name}` : ''} {a.operator ? `| Operator: ${a.operator.name}` : ''}
              </p>
            )}
            {addChems.length > 0 ? (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-300">
                    <th className="text-left py-1 font-semibold w-8">#</th>
                    <th className="text-left py-1 font-semibold">Chemical</th>
                    <th className="text-right py-1 font-semibold w-24">Quantity</th>
                    <th className="text-left py-1 font-semibold w-16 pl-2">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {addChems.map((c: any, i: number) => (
                    <tr key={c.id} className="border-b border-gray-200">
                      <td className="py-1 text-gray-500">{i + 1}</td>
                      <td className="py-1">{c.name}</td>
                      <td className="py-1 text-right">{c.quantity != null ? c.quantity : '\u2014'}</td>
                      <td className="py-1 pl-2 text-gray-600">{c.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-500 italic">No chemicals.</p>
            )}
          </div>
        )
      })}

      {/* Actual Total (for ?round=all) */}
      {showRound === 'all' && actualTotalCost > 0 && (
        <div className="border-t-2 border-black mt-6 pt-3 text-sm">
          <div className="flex justify-between mb-1">
            <span>Round 1 Cost:</span>
            <span>{'\u20B9'}{round1Cost.toFixed(2)}</span>
          </div>
          {allAdditionsCost > 0 && (
            <div className="flex justify-between mb-1 text-red-600">
              <span>Additions / Re-Dye Cost:</span>
              <span>+{'\u20B9'}{allAdditionsCost.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base border-t border-gray-400 pt-1">
            <span>Actual Total:</span>
            <span>{'\u20B9'}{actualTotalCost.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Notes */}
      {entry.notes && (
        <div className="text-sm mt-4 border-t border-gray-300 pt-2">
          <span className="font-semibold">Notes: </span>{entry.notes}
        </div>
      )}

      {/* Signature */}
      <div className="mt-12 flex justify-between text-sm">
        <div className="text-center">
          <div className="border-t border-black w-40 pt-1">Prepared By</div>
        </div>
        <div className="text-center">
          <div className="border-t border-black w-40 pt-1">Approved By</div>
        </div>
      </div>

      {/* Print buttons (screen only) */}
      <div className="no-print mt-8 flex flex-wrap justify-center items-start gap-3">
        <PrintButton />
        <SharePDFButton slip={{
          slipNo: entry.slipNo,
          date: entry.date,
          partyName: partyName || null,
          shadeName: entry.shadeName || null,
          shadeDescription: shadeDescription || null,
          qualityName: qualityName || null,
          marka: entryMarka || null,
          isPcJob: entry.isPcJob || false,
          lots: lots.map((l: any) => ({ lotNo: l.lotNo, than: l.than, marka: lotMarkaMap.get(l.lotNo.toLowerCase().trim()) || null })),
          chemicals: chemicals.map((c: any) => ({ name: c.name, quantity: c.quantity, unit: c.unit, rate: c.rate, cost: c.cost, processTag: c.processTag || null })),
          notes: entry.notes || null,
          status: entry.status || null,
          dyeingDoneAt: entry.dyeingDoneAt || null,
          machine: entry.machine?.name || null,
          operator: entry.operator?.name || null,
          totalRounds: totalRounds,
          isReDyed: isReDyed,
        }} />
        <ReceiptPrint data={{
          slipNo: entry.slipNo,
          date: new Date(entry.date).toLocaleDateString('en-IN'),
          partyName,
          shadeName: entry.shadeName || null,
          shadeDescription: shadeDescription || null,
          qualityName: qualityName || null,
          marka: entryMarka || null,
          isPcJob: entry.isPcJob || false,
          machineName: entry.machine?.name || null,
          operatorName: entry.operator?.name || null,
          lots: lots.map((l: any) => ({ lotNo: l.lotNo, than: l.than, marka: lotMarkaMap.get(l.lotNo.toLowerCase().trim()) || null })),
          totalThan,
          chemicals: chemicals.map((c: any) => ({ name: c.name, quantity: c.quantity, unit: c.unit, processTag: c.processTag || null })),
          isReDyed,
          totalRounds,
          additions: (entry.additions || []).map((a: any) => ({
            roundNo: a.roundNo, type: a.type, defectType: a.defectType || null, reason: a.reason || null,
            machineName: a.machine?.name || null, operatorName: a.operator?.name || null,
            chemicals: (a.chemicals || []).map((c: any) => ({ name: c.name, quantity: c.quantity, unit: c.unit })),
          })),
          roundParam: showRound,
        }} />
        <BluetoothPrint data={{
          slipNo: entry.slipNo,
          date: new Date(entry.date).toLocaleDateString('en-IN'),
          partyName,
          shadeName: entry.shadeName || null,
          shadeDescription: shadeDescription || null,
          qualityName: qualityName || null,
          marka: entryMarka || null,
          isPcJob: entry.isPcJob || false,
          machineName: entry.machine?.name || null,
          operatorName: entry.operator?.name || null,
          lots: lots.map((l: any) => ({ lotNo: l.lotNo, than: l.than, marka: lotMarkaMap.get(l.lotNo.toLowerCase().trim()) || null })),
          totalThan,
          chemicals: chemicals.map((c: any) => ({ name: c.name, quantity: c.quantity, unit: c.unit, processTag: c.processTag || null })),
          isReDyed,
          totalRounds,
          additions: (entry.additions || []).map((a: any) => ({
            roundNo: a.roundNo,
            type: a.type,
            defectType: a.defectType || null,
            reason: a.reason || null,
            machineName: a.machine?.name || null,
            operatorName: a.operator?.name || null,
            chemicals: (a.chemicals || []).map((c: any) => ({ name: c.name, quantity: c.quantity, unit: c.unit })),
          })),
          roundParam: showRound,
        }} />
      </div>

      {/* Round navigation (screen only) */}
      {isReDyed && (
        <div className="no-print mt-4 text-center space-x-2">
          <a href={`/dyeing/${id}/print`} className="text-sm text-purple-600 hover:underline">Round 1</a>
          {(entry.additions || []).map((a: any) => (
            <a key={a.id} href={`/dyeing/${id}/print?round=${a.roundNo}`} className="text-sm text-purple-600 hover:underline">Round {a.roundNo}</a>
          ))}
          <a href={`/dyeing/${id}/print?round=all`} className="text-sm text-purple-600 hover:underline font-medium">All Rounds</a>
        </div>
      )}
    </div>
  )
}
