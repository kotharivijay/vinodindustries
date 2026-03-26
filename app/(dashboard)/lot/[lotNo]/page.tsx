import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import BackButton from '../../BackButton'

export default async function LotTrackPage({ params }: { params: { lotNo: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const lotNo = decodeURIComponent(params.lotNo)

  const db = prisma as any

  const [greyEntries, despatchEntries] = await Promise.all([
    prisma.greyEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { party: true, quality: true, transport: true, weaver: true },
      orderBy: { date: 'asc' },
    }),
    prisma.despatchEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { party: true, quality: true, transport: true },
      orderBy: { date: 'asc' },
    }),
  ])

  // Fetch opening balance (carry-forward from last year)
  let openingBalance: any = null
  try {
    openingBalance = await db.lotOpeningBalance.findFirst({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { despatchHistory: { orderBy: { setNo: 'asc' } } },
    })
  } catch {}

  const obThan = openingBalance?.openingThan ?? 0

  // Find dyeing entries via DyeingEntryLot (correct) + fallback to lotNo field
  let dyeingEntries: any[] = []
  try {
    // Find all lot entries for this lot number
    const lotEntries = await db.dyeingEntryLot.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: {
        entry: {
          include: {
            chemicals: { include: { chemical: true } },
            lots: true,
          },
        },
      },
    })
    // Map to entries with this lot's specific than
    dyeingEntries = lotEntries.map((le: any) => ({
      ...le.entry,
      _lotThan: le.than, // this specific lot's than
    }))
    // Deduplicate by entry id (in case of double match)
    const seen = new Set()
    dyeingEntries = dyeingEntries.filter((e: any) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
  } catch {
    // Fallback if DyeingEntryLot table doesn't exist
    dyeingEntries = (await prisma.dyeingEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      orderBy: { date: 'asc' },
    })).map(e => ({ ...e, _lotThan: e.than, lots: [], chemicals: [] }))
  }

  // Find fold entries via FoldBatchLot
  let foldEntries: any[] = []
  try {
    foldEntries = await db.foldBatchLot.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: {
        foldBatch: {
          include: {
            shade: true,
            foldProgram: true,
          },
        },
      },
    })
  } catch {}

  // Find finish entries via FinishEntryLot
  let finishEntries: any[] = []
  try {
    const finishLots = await db.finishEntryLot.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: {
        entry: {
          include: {
            chemicals: { include: { chemical: true } },
            lots: true,
          },
        },
      },
    })
    finishEntries = finishLots.map((le: any) => ({
      ...le.entry,
      _lotThan: le.than,
      _lotMeter: le.meter,
    }))
    const seenFinish = new Set()
    finishEntries = finishEntries.filter((e: any) => {
      if (seenFinish.has(e.id)) return false
      seenFinish.add(e.id)
      return true
    })
  } catch {
    // fallback if FinishEntryLot table doesn't exist yet
  }

  const greyThan = greyEntries.reduce((s, e) => s + e.than, 0)
  const despatchThan = despatchEntries.reduce((s, e) => s + e.than, 0)
  const dyeingThan = dyeingEntries.reduce((s: number, e: any) => s + (e._lotThan ?? e.than), 0)
  const finishThan = finishEntries.reduce((s: number, e: any) => s + (e._lotThan ?? e.than), 0)
  const foldThan = foldEntries.reduce((s: number, e: any) => s + (e.than ?? 0), 0)
  const stock = obThan + greyThan - despatchThan

  const fmt = (d: Date) => new Date(d).toLocaleDateString('en-IN')

  return (
    <div className="p-4 md:p-8 max-w-3xl dark:text-gray-100">
      <div className="flex items-center gap-4 mb-6">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Lot Track: <span className="text-indigo-600">{lotNo}</span></h1>
          <p className="text-sm text-gray-500 mt-0.5">Full process history for this lot</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className={`grid grid-cols-2 ${obThan > 0 ? 'sm:grid-cols-7' : 'sm:grid-cols-6'} gap-3 mb-8`}>
        {obThan > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Opening Bal</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{obThan}</p>
            <p className="text-xs text-gray-400">carry-forward</p>
          </div>
        )}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Grey Inward</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{greyThan}</p>
          <p className="text-xs text-gray-400">{greyEntries.length} entries</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Dyeing</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">{dyeingThan}</p>
          <p className="text-xs text-gray-400">{dyeingEntries.length} entries</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Finish</p>
          <p className="text-2xl font-bold text-teal-600 mt-1">{finishThan}</p>
          <p className="text-xs text-gray-400">{finishEntries.length} entries</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Fold</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{foldThan}</p>
          <p className="text-xs text-gray-400">{foldEntries.length} batch{foldEntries.length !== 1 ? 'es' : ''}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Despatched</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">{despatchThan}</p>
          <p className="text-xs text-gray-400">{despatchEntries.length} entries</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Balance</p>
          <p className={`text-2xl font-bold mt-1 ${stock > 0 ? 'text-green-600' : stock < 0 ? 'text-red-600' : 'text-gray-400'}`}>{stock}</p>
          <p className="text-xs text-gray-400">in stock</p>
        </div>
      </div>

      {/* Opening Balance (carry-forward) */}
      {openingBalance && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">Opening Balance (Carry-Forward from {openingBalance.financialYear})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
            <div className="grid grid-cols-2 gap-3 text-sm mb-3">
              <div><span className="text-gray-400 text-xs">Original Grey</span><p className="font-semibold">{openingBalance.greyThan} than</p></div>
              <div><span className="text-gray-400 text-xs">Despatched (prev yr)</span><p className="font-semibold">{openingBalance.totalDespatched} than</p></div>
              <div><span className="text-gray-400 text-xs">Carry-Forward</span><p className="font-bold text-blue-600">{openingBalance.openingThan} than</p></div>
              {openingBalance.party && <div><span className="text-gray-400 text-xs">Party</span><p>{openingBalance.party}</p></div>}
            </div>

            {/* Previous year despatch history */}
            {openingBalance.despatchHistory?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-2">Previous Year Despatch</p>
                <div className="space-y-1">
                  {openingBalance.despatchHistory.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-4 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                      <span>Ch: {d.challanNo}</span>
                      <span className="font-semibold">{d.than} than</span>
                      {d.billNo && <span>Bill: {d.billNo}</span>}
                      {d.rate && <span>@ &#8377;{d.rate}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Grey entries */}
      {greyEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">📦 Grey Inward ({greyEntries.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50">
            {greyEntries.map(e => (
              <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-gray-500 text-xs">{fmt(e.date)}</span>
                <span className="font-medium text-gray-800">{e.party.name}</span>
                <span className="text-gray-500">{e.quality.name}</span>
                <span className="text-gray-600">Ch: {e.challanNo}</span>
                <span className="font-semibold text-gray-800">Than: {e.than}</span>
                <span className="text-gray-500 text-xs">{e.transport.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fold entries */}
      {foldEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">🗂️ Fold Program ({foldEntries.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
            {foldEntries.map((e: any) => {
              const batch = e.foldBatch
              const program = batch?.foldProgram
              const shade = batch?.shade?.name ?? batch?.shadeName ?? null
              return (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-500 text-xs">{fmt(program?.date)}</span>
                    <Link href={`/fold/${program?.id}`} className="text-indigo-600 font-medium hover:underline">
                      {program?.foldNo}
                    </Link>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      program?.status === 'confirmed'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {program?.status}
                    </span>
                    <span className="text-gray-500">Batch {batch?.batchNo}</span>
                    {shade && <span className="font-medium text-indigo-700 dark:text-indigo-400">Shade: {shade}</span>}
                    <span className="font-semibold text-indigo-700 dark:text-indigo-300">Than: {e.than}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Dyeing entries */}
      {dyeingEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">🎨 Dyeing Slip ({dyeingEntries.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50">
            {dyeingEntries.map((e: any) => {
              const lotThan = e._lotThan ?? e.than
              const totalCost = e.chemicals?.reduce((s: number, c: any) => s + (c.cost ?? 0), 0) ?? 0
              return (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-500 text-xs">{fmt(e.date)}</span>
                    <Link href={`/dyeing/${e.id}`} className="text-purple-600 font-medium hover:underline">
                      Slip {e.slipNo}
                    </Link>
                    <span className="font-semibold text-purple-700">Than: {lotThan}</span>
                    {totalCost > 0 && <span className="text-xs text-gray-500">Cost: ₹{totalCost.toFixed(0)}</span>}
                  </div>
                  {/* Show other lots in this slip */}
                  {e.lots?.length > 1 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {e.lots.filter((l: any) => l.lotNo.toLowerCase() !== lotNo.toLowerCase()).map((l: any, i: number) => (
                        <span key={i} className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                          +{l.lotNo} ({l.than})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Finish entries */}
      {finishEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">&#10024; Finish/Center ({finishEntries.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50">
            {finishEntries.map((e: any) => {
              const lotThan = e._lotThan ?? e.than
              const lotMeter = e._lotMeter ?? null
              const totalCost = e.chemicals?.reduce((s: number, c: any) => s + (c.cost ?? 0), 0) ?? 0
              return (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-500 text-xs">{fmt(e.date)}</span>
                    <Link href={`/finish/${e.id}`} className="text-teal-600 font-medium hover:underline">
                      Slip {e.slipNo}
                    </Link>
                    <span className="font-semibold text-teal-700">Than: {lotThan}</span>
                    {lotMeter != null && lotMeter > 0 && <span className="text-xs text-gray-500">Meter: {lotMeter}</span>}
                    {totalCost > 0 && <span className="text-xs text-gray-500">Cost: &#8377;{totalCost.toFixed(0)}</span>}
                  </div>
                  {e.lots?.length > 1 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {e.lots.filter((l: any) => l.lotNo.toLowerCase() !== lotNo.toLowerCase()).map((l: any, i: number) => (
                        <span key={i} className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                          +{l.lotNo} ({l.than})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Despatch entries */}
      {despatchEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">🚚 Despatch ({despatchEntries.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50">
            {despatchEntries.map(e => (
              <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-gray-500 text-xs">{fmt(e.date)}</span>
                <span className="font-medium text-gray-800">{e.party.name}</span>
                <span className="text-gray-600">Ch: {e.challanNo}</span>
                <span className="font-semibold text-orange-700">Than: {e.than}</span>
                {e.pTotal != null && <span className="text-gray-700">₹{e.pTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>}
                <span className="text-gray-500 text-xs">{e.transport?.name ?? '—'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {greyEntries.length === 0 && despatchEntries.length === 0 && dyeingEntries.length === 0 && finishEntries.length === 0 && foldEntries.length === 0 && (
        <div className="text-center text-gray-400 py-16">No records found for lot <strong>{lotNo}</strong></div>
      )}
    </div>
  )
}
