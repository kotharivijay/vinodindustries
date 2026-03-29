import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import PrintTrigger, { PrintButton } from './PrintTrigger'

export default async function DyeingPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = prisma as any

  const entry = await db.dyeingEntry.findUnique({
    where: { id: parseInt(id) },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
      machine: true,
      operator: true,
    },
  })

  if (!entry) notFound()

  // Enrich with party name
  const lotNos = entry.lots?.length ? entry.lots.map((l: any) => l.lotNo) : [entry.lotNo]
  const greyWithParty = await prisma.greyEntry.findMany({
    where: { lotNo: { in: lotNos } },
    select: { lotNo: true, party: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  const partyNames = [...new Set(greyWithParty.map(g => g.party.name))]
  const partyName = partyNames.join(', ') || null

  // Group chemicals by processTag
  const chemicals = entry.chemicals || []
  const grouped: Record<string, typeof chemicals> = {}
  for (const c of chemicals) {
    const tag = c.processTag || '_other'
    if (!grouped[tag]) grouped[tag] = []
    grouped[tag].push(c)
  }

  // Sort order: shade first, then alphabetically, then _other last
  const tagOrder = Object.keys(grouped).sort((a, b) => {
    if (a === 'shade') return -1
    if (b === 'shade') return 1
    if (a === '_other') return 1
    if (b === '_other') return -1
    return a.localeCompare(b)
  })

  const lots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo, than: entry.than }]
  const totalThan = lots.reduce((s: number, l: any) => s + l.than, 0)

  return (
    <div className="print-page bg-white text-black min-h-screen">
      <PrintTrigger />

      <style>{`
        @media print {
          body { margin: 0; padding: 0; }
          .print-page { padding: 10mm; font-size: 11pt; }
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
        <p className="text-sm text-gray-600">Dyeing Slip</p>
      </div>

      {/* Slip Info Grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm mb-4 border border-gray-300 rounded p-3">
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
          <span>{entry.shadeName || '\u2014'}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Machine:</span>
          <span>{entry.machine?.name || '\u2014'}</span>
        </div>
        <div className="flex gap-2">
          <span className="font-semibold w-24">Operator:</span>
          <span>{entry.operator?.name || '\u2014'}</span>
        </div>
      </div>

      {/* Lots */}
      <div className="text-sm mb-4">
        <span className="font-semibold">Lots: </span>
        {lots.map((l: any, i: number) => (
          <span key={i}>
            {l.lotNo} ({l.than} than){i < lots.length - 1 ? ', ' : ''}
          </span>
        ))}
        {lots.length > 1 && (
          <span className="ml-2 font-semibold">Total: {totalThan} than</span>
        )}
      </div>

      {/* Chemicals grouped by process */}
      {tagOrder.map(tag => {
        const tagChems = grouped[tag]
        const label = tag === 'shade' ? 'Shade Chemicals' : tag === '_other' ? 'Other Chemicals' : tag
        return (
          <div key={tag} className="mb-4">
            <h3 className="text-sm font-bold uppercase tracking-wide border-b border-gray-400 pb-1 mb-2">
              {label}
            </h3>
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
                {tagChems.map((c: any, i: number) => (
                  <tr key={c.id} className="border-b border-gray-200">
                    <td className="py-1 text-gray-500">{i + 1}</td>
                    <td className="py-1">{c.name}</td>
                    <td className="py-1 text-right">{c.quantity != null ? c.quantity : '\u2014'}</td>
                    <td className="py-1 pl-2 text-gray-600">{c.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {chemicals.length === 0 && (
        <p className="text-sm text-gray-500 italic my-4">No chemicals recorded.</p>
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

      {/* Print button (screen only) */}
      <PrintButton />
    </div>
  )
}
