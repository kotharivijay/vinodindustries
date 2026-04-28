import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { buildLotInfoMap } from '@/lib/lot-info'
import PrintActions from './PrintActions'

export default async function FinishPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = prisma as any

  const entry = await db.finishEntry.findUnique({
    where: { id: parseInt(id) },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
    },
  })
  if (!entry) notFound()

  const lots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo, than: entry.than, meter: null }]
  const lotNos = lots.map((l: any) => l.lotNo)
  const totalThan = lots.reduce((s: number, l: any) => s + l.than, 0)

  // Aggregate by lotNo for the top-of-print Lot Summary section.
  const lotSummaryMap = new Map<string, number>()
  for (const l of lots) lotSummaryMap.set(l.lotNo, (lotSummaryMap.get(l.lotNo) || 0) + (l.than || 0))
  const lotSummary = Array.from(lotSummaryMap.entries())
    .map(([lotNo, than]) => ({ lotNo, than }))
    .sort((a, b) => a.lotNo.localeCompare(b.lotNo))

  // Get party + quality from lot info
  const lotInfoMap = await buildLotInfoMap(lotNos)
  const partyNames = [...new Set(Array.from(lotInfoMap.values()).map(v => v.party).filter(Boolean))]
  const qualityNames = [...new Set(Array.from(lotInfoMap.values()).map(v => v.quality).filter(Boolean))]
  const partyName = partyNames.join(', ') || null
  const qualityName = qualityNames.join(', ') || null

  // Get dyeing info (shade, fold) for these lots
  const dyeingEntries = await db.dyeingEntry.findMany({
    where: {
      OR: [
        { lotNo: { in: lotNos } },
        { lots: { some: { lotNo: { in: lotNos } } } },
      ],
    },
    select: {
      id: true,
      slipNo: true,
      shadeName: true,
      lots: { select: { lotNo: true, than: true } },
      foldBatch: {
        select: {
          batchNo: true,
          foldProgram: { select: { foldNo: true } },
          shade: { select: { name: true, description: true } },
        },
      },
    },
    distinct: ['id'],
  })

  // Build fold → slips grouping
  type SlipInfo = { slipNo: number; shadeName: string | null; shadeDesc: string | null; lots: { lotNo: string; than: number }[] }
  type FoldGroup = { foldNo: string; slips: SlipInfo[] }
  const foldMap = new Map<string, SlipInfo[]>()

  for (const de of dyeingEntries) {
    const foldNo = de.foldBatch?.foldProgram?.foldNo || 'No Fold'
    const shadeName = de.shadeName || de.foldBatch?.shade?.name || null
    const shadeDesc = de.foldBatch?.shade?.description || null
    const dLots = de.lots?.length ? de.lots : [{ lotNo: de.lotNo, than: de.than }]
    // Only include lots that are in this finish entry
    const relevantLots = dLots.filter((dl: any) => lotNos.includes(dl.lotNo))
    if (relevantLots.length === 0) continue

    if (!foldMap.has(foldNo)) foldMap.set(foldNo, [])
    foldMap.get(foldNo)!.push({
      slipNo: de.slipNo,
      shadeName,
      shadeDesc,
      lots: relevantLots.map((l: any) => ({ lotNo: l.lotNo, than: l.than })),
    })
  }

  const foldGroups: FoldGroup[] = Array.from(foldMap.entries())
    .map(([foldNo, slips]) => ({ foldNo, slips }))
    .sort((a, b) => a.foldNo.localeCompare(b.foldNo))

  const chemicals = (entry.chemicals || []).map((c: any) => ({
    name: c.name || c.chemical?.name || '',
    quantity: c.quantity,
    unit: c.unit,
  }))

  const dateStr = new Date(entry.date).toLocaleDateString('en-IN')

  // Data for client components
  const printData = {
    slipNo: entry.slipNo,
    date: dateStr,
    partyName,
    qualityName,
    foldGroups,
    totalThan,
    totalMeter: entry.meter,
    chemicals,
    notes: entry.notes,
  }

  return (
    <div className="print-page bg-white text-black min-h-screen" data-theme="light">
      <style>{`
        .print-page {
          background: #fff !important;
          color: #000 !important;
        }
        @media print {
          body, html { background: #fff !important; color: #000 !important; }
          .print-page { padding: 10mm; }
          .no-print { display: none !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
        @media screen {
          .print-page { max-width: 800px; margin: 0 auto; padding: 24px; }
        }
      `}</style>

      {/* Header */}
      <div className="text-center border-b-2 border-black pb-3 mb-4">
        <h1 className="text-xl font-bold tracking-wide">KOTHARI SYNTHETIC INDUSTRIES</h1>
        <p className="text-sm text-gray-600">Finish Program</p>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm mb-4 border border-gray-300 rounded p-3">
        <div className="flex gap-2">
          <span className="font-semibold w-24">Date:</span>
          <span>{dateStr}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Finish Prg No:</span>
          <span>{entry.slipNo}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Party:</span>
          <span>{partyName || '\u2014'}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Quality:</span>
          <span>{qualityName || '\u2014'}</span>
        </div>
      </div>

      {/* Lot Summary — aggregated than per unique lot in this finish program */}
      <div className="mb-4 border border-gray-300 rounded">
        <h3 className="text-sm font-bold uppercase tracking-wide px-3 py-1.5 border-b border-gray-300 bg-gray-50">
          Lot Summary
        </h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-1 px-3 font-semibold">Lot No</th>
              <th className="text-right py-1 px-3 font-semibold w-32">Total Than</th>
            </tr>
          </thead>
          <tbody>
            {lotSummary.map(l => (
              <tr key={l.lotNo} className="border-b border-gray-200">
                <td className="py-1 px-3 font-medium">{l.lotNo}</td>
                <td className="py-1 px-3 text-right">{l.than}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1 px-3 font-bold">Total</td>
              <td className="py-1 px-3 text-right font-bold">{totalThan}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Fold → Slip → Lots */}
      {foldGroups.map(fg => (
        <div key={fg.foldNo} className="mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 pb-1 mb-2">
            Fold No: {fg.foldNo}
          </h3>
          <table className="w-full text-sm border-collapse mb-2">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-1 font-semibold w-16">Slip</th>
                <th className="text-left py-1 font-semibold">Shade</th>
                <th className="text-left py-1 font-semibold w-28">Lot</th>
                <th className="text-right py-1 font-semibold w-14">Than</th>
              </tr>
            </thead>
            <tbody>
              {fg.slips.map((slip, si) => (
                slip.lots.map((lot, li) => (
                  <tr key={`${si}-${li}`} className="border-b border-gray-200">
                    <td className="py-1 font-medium">{li === 0 ? slip.slipNo : ''}</td>
                    <td className="py-1 text-gray-700">{li === 0 ? [slip.shadeName, slip.shadeDesc].filter(Boolean).join(' \u2014 ') || '\u2014' : ''}</td>
                    <td className="py-1 font-medium">{lot.lotNo}</td>
                    <td className="py-1 text-right">{lot.than}</td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* If no fold groups found, show lots directly */}
      {foldGroups.length === 0 && (
        <div className="mb-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-1 font-semibold">Lot</th>
                <th className="text-right py-1 font-semibold w-14">Than</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l: any, i: number) => (
                <tr key={i} className="border-b border-gray-200">
                  <td className="py-1 font-medium">{l.lotNo}</td>
                  <td className="py-1 text-right">{l.than}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      <div className="flex gap-8 text-sm mb-4 border border-gray-300 rounded p-3">
        <div className="flex gap-2">
          <span className="font-semibold">Total Than:</span>
          <span className="font-bold">{totalThan}</span>
        </div>
        <div className="flex gap-2 flex-1">
          <span className="font-semibold">Total Meter:</span>
          <span className="border-b border-gray-400 flex-1 min-w-[120px]">{entry.meter || ''}</span>
        </div>
        <div className="flex gap-2 flex-1">
          <span className="font-semibold">Than:</span>
          <span className="border-b border-gray-400 flex-1 min-w-[80px]"></span>
        </div>
      </div>

      {/* Chemicals */}
      {chemicals.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 pb-1 mb-2">
            Chemicals (per 100 Litres)
          </h3>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-1 font-semibold w-8">#</th>
                <th className="text-left py-1 font-semibold">Chemical</th>
                <th className="text-right py-1 font-semibold w-20">Qty</th>
                <th className="text-left py-1 font-semibold w-12 pl-2">Unit</th>
              </tr>
            </thead>
            <tbody>
              {chemicals.map((c: any, i: number) => (
                <tr key={i} className="border-b border-gray-200">
                  <td className="py-1 text-gray-500">{i + 1}</td>
                  <td className="py-1">{c.name}</td>
                  <td className="py-1 text-right font-medium">{c.quantity != null ? Number(c.quantity).toFixed(1) : '\u2014'}</td>
                  <td className="py-1 pl-2 text-gray-600">{c.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PCS Shortage Table */}
      <div className="mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 pb-1 mb-2">
          PCS Shortage
        </h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-1 font-semibold">Lot</th>
              <th className="text-left py-1 font-semibold w-20">Pcs No</th>
              <th className="text-left py-1 font-semibold w-24">G_Mtr</th>
              <th className="text-left py-1 font-semibold w-24">F_Mtr</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map(i => (
              <tr key={i} className="border-b border-gray-200">
                <td className="py-2"><span className="border-b border-gray-300 inline-block w-full min-h-[16px]"></span></td>
                <td className="py-2"><span className="border-b border-gray-300 inline-block w-full min-h-[16px]"></span></td>
                <td className="py-2"><span className="border-b border-gray-300 inline-block w-full min-h-[16px]"></span></td>
                <td className="py-2"><span className="border-b border-gray-300 inline-block w-full min-h-[16px]"></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      {entry.notes && (
        <div className="text-sm mb-4 border-t border-gray-300 pt-2">
          <span className="font-semibold">Notes: </span>{entry.notes}
        </div>
      )}

      {/* Signature Lines */}
      <div className="mt-12 flex justify-between text-sm">
        <div className="text-center">
          <div className="border-t border-black w-40 pt-1">Prepared By</div>
        </div>
        <div className="text-center">
          <div className="border-t border-black w-40 pt-1">Approved By</div>
        </div>
      </div>

      {/* Action buttons (screen only) */}
      <div className="no-print mt-8 flex flex-wrap justify-center gap-3">
        <PrintActions data={printData} />
      </div>
    </div>
  )
}
