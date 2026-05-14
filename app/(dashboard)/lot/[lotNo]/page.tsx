import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import BackButton from '../../BackButton'
import ShareDyeingPDFButton from './ShareDyeingPDFButton'
import EditCarryForward from './EditCarryForward'
import EditAllocations from './EditAllocations'
import EditStartStage from './EditStartStage'

export default async function LotTrackPage({ params }: { params: { lotNo: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const lotNo = decodeURIComponent(params.lotNo)

  const db = prisma as any

  const [greyEntries, despatchLotRows, despatchParentOnly] = await Promise.all([
    prisma.greyEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { party: true, quality: true, transport: true, weaver: true },
      orderBy: { date: 'asc' },
    }),
    // Multi-lot despatches: this lot appears as a row under DespatchEntryLot
    prisma.despatchEntryLot.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { entry: { include: { party: true, quality: true, transport: true } } },
      orderBy: { entry: { date: 'asc' } },
    }),
    // Legacy single-lot despatches (no DespatchEntryLot rows) where parent lotNo = this lot
    prisma.despatchEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' }, despatchLots: { none: {} } },
      include: { party: true, quality: true, transport: true },
      orderBy: { date: 'asc' },
    }),
  ])

  // Flatten: for multi-lot rows use row.than (per-lot); for legacy entries use entry.than.
  const despatchEntries = [
    ...despatchLotRows.map(r => ({
      id: `l${r.id}`,
      date: r.entry.date,
      challanNo: r.entry.challanNo,
      party: r.entry.party,
      quality: r.entry.quality,
      transport: r.entry.transport,
      than: r.than,
      pTotal: r.amount ?? (r.rate != null ? r.than * r.rate : null),
    })),
    ...despatchParentOnly.map(e => ({
      id: e.id, date: e.date, challanNo: e.challanNo,
      party: e.party, quality: e.quality, transport: e.transport,
      than: e.than, pTotal: e.pTotal,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // Fetch opening balance (carry-forward from last year)
  let openingBalance: any = null
  try {
    openingBalance = await db.lotOpeningBalance.findFirst({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: {
        despatchHistory: { orderBy: { setNo: 'asc' } },
        allocations: { orderBy: { id: 'asc' } },
      },
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

  // Find fold entries via FoldBatchLot. Exclude cancelled batches from the
  // active list so foldThan + count reflect what's actually allocated; the
  // cancelled rows are surfaced separately below for audit.
  let foldEntries: any[] = []
  let cancelledFoldEntries: any[] = []
  try {
    const allFold = await db.foldBatchLot.findMany({
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
    foldEntries = allFold.filter((e: any) => !e.foldBatch?.cancelled)
    cancelledFoldEntries = allFold.filter((e: any) => e.foldBatch?.cancelled)
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

  // Find folding receipts via FoldingReceipt -> FinishEntryLot
  let foldingReceipts: any[] = []
  try {
    const lotEntriesForFR = await db.finishEntryLot.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      select: { id: true },
    })
    if (lotEntriesForFR.length > 0) {
      foldingReceipts = await db.foldingReceipt.findMany({
        where: { lotEntryId: { in: lotEntriesForFR.map((le: any) => le.id) } },
        orderBy: { date: 'asc' },
      })
    }
  } catch {}

  // Find packing entries via PackingLot
  let packingEntries: any[] = []
  try {
    const packingLots = await db.packingLot.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: {
        packingEntry: true,
      },
    })
    packingEntries = packingLots.map((pl: any) => ({
      ...pl.packingEntry,
      _lotThan: pl.than,
      _lotBoxes: pl.boxes,
    }))
  } catch {}

  // Find re-process entries (as source lot OR as RE-PRO lot)
  let reproEntries: any[] = []
  try {
    const asSrc = await db.reProcessSource.findMany({
      where: { originalLotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { reprocess: true },
    })
    const asRepro = await db.reProcessLot.findMany({
      where: { reproNo: { equals: lotNo, mode: 'insensitive' } },
      include: { sources: true },
    })
    reproEntries = [...asSrc.map((s: any) => ({ type: 'source', ...s })), ...asRepro.map((r: any) => ({ type: 'repro', ...r }))]
  } catch {}

  // Inject OB allocations as synthetic entries — skip if a real slipNo=0 entry exists
  const obAllocations = openingBalance?.allocations || []
  const hasRealOBFinish = finishEntries.some((e: any) => e.slipNo === 0)
  const hasRealOBPacking = packingEntries.some((e: any) => e.packingNo === 'OB' || false)
  for (const alloc of obAllocations) {
    if (alloc.stage === 'dyed') {
      dyeingEntries.push({
        id: -alloc.id,
        slipNo: 'OB',
        date: openingBalance.greyDate || openingBalance.createdAt,
        _lotThan: alloc.than,
        chemicals: [],
        lots: [],
        _isOB: true,
      })
    } else if (alloc.stage === 'finished' && !hasRealOBFinish) {
      finishEntries.push({
        id: -alloc.id,
        slipNo: 'OB',
        date: openingBalance.greyDate || openingBalance.createdAt,
        _lotThan: alloc.than,
        _lotMeter: null,
        chemicals: [],
        lots: [],
        _isOB: true,
      })
    } else if (alloc.stage === 'packed') {
      packingEntries.push({
        id: -alloc.id,
        packingNo: 'OB',
        date: openingBalance.greyDate || openingBalance.createdAt,
        status: 'confirmed',
        notes: null,
        _lotThan: alloc.than,
        _lotBoxes: null,
        _isOB: true,
      })
    }
  }

  const greyThan = greyEntries.reduce((s, e) => s + e.than, 0)
  const despatchThan = despatchEntries.reduce((s, e) => s + e.than, 0)
  const dyeingThan = dyeingEntries.reduce((s: number, e: any) => s + (e._lotThan ?? e.than), 0)
  const finishThan = finishEntries.reduce((s: number, e: any) => s + (e._lotThan ?? e.than), 0)
  const foldThan = foldEntries.reduce((s: number, e: any) => s + (e.than ?? 0), 0)
  const frThan = foldingReceipts.reduce((s: number, e: any) => s + (e.than ?? 0), 0)
  const packingThan = packingEntries.reduce((s: number, e: any) => s + (e._lotThan ?? 0), 0)
  const reproThan = reproEntries.filter((r: any) => r.type === 'source').reduce((s: number, r: any) => s + (r.than ?? 0), 0)
  const stock = obThan + greyThan - despatchThan

  const fmt = (d: Date) => new Date(d).toLocaleDateString('en-IN')

  // Resolve lot's owner party + quality. Grey entry wins; OB is fallback for carry-forward lots.
  const lotParty = greyEntries[0]?.party?.name ?? openingBalance?.party ?? null
  const lotQuality = greyEntries[0]?.quality?.name ?? openingBalance?.quality ?? null

  // Start-stage override (only meaningful for current-year lots that have a GreyEntry)
  const startStage = (greyEntries[0]?.startStage as 'finish' | 'folding' | null | undefined) ?? null

  return (
    <div className="p-4 md:p-8 max-w-3xl dark:text-gray-100">
      <div className="flex items-center gap-4 mb-6">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800">Lot Track: <span className="text-indigo-600">{lotNo}</span></h1>
          {(lotParty || lotQuality) && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
              {lotParty && <span className="font-medium">{lotParty}</span>}
              {lotParty && lotQuality && <span className="text-gray-400 mx-1.5">·</span>}
              {lotQuality && <span>{lotQuality}</span>}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">Full process history for this lot</p>
        </div>
        {greyEntries.length > 0 && (
          <EditStartStage lotNo={lotNo} initial={startStage as any} />
        )}
      </div>

      {/* RE-PRO banner — when this lot IS a re-process lot */}
      {(() => {
        const reproSelf = reproEntries.find((r: any) => r.type === 'repro')
        if (!reproSelf) return null
        return (
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl px-4 py-3 mb-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">🔄</span>
              <span className="text-sm font-bold text-purple-700 dark:text-purple-300">Re-Process Lot</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${reproSelf.status === 'merged' ? 'bg-purple-200 text-purple-800 dark:bg-purple-800/40 dark:text-purple-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>{reproSelf.status}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{reproSelf.totalThan} total · {reproSelf.quality}</span>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1.5">{reproSelf.reason}{reproSelf.notes ? ` — ${reproSelf.notes}` : ''}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] uppercase text-gray-400 self-center mr-1">Sources:</span>
              {(reproSelf.sources || []).map((s: any) => (
                <Link key={s.id} href={`/lot/${encodeURIComponent(s.originalLotNo)}`}
                  className="inline-flex items-center gap-1 bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300 text-xs font-medium px-2 py-0.5 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/30">
                  {s.originalLotNo} <span className="text-gray-400">{s.than}</span>
                </Link>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
        {obThan > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Opening Bal</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{obThan}</p>
            <p className="text-xs text-gray-400">carry-forward</p>
          </div>
        )}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Grey Inward</p>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">{greyThan}</p>
          <p className="text-xs text-gray-400">{greyEntries.length} entries</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Fold</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{foldThan}</p>
          <p className="text-xs text-gray-400">{foldEntries.length} batch{foldEntries.length !== 1 ? 'es' : ''}</p>
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
        {foldingReceipts.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Folding Rec</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{frThan}</p>
            <p className="text-xs text-gray-400">{foldingReceipts.length} FR</p>
          </div>
        )}
        {packingEntries.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Packing</p>
            <p className="text-2xl font-bold text-pink-600 mt-1">{packingThan}</p>
            <p className="text-xs text-gray-400">{packingEntries.length} entries</p>
          </div>
        )}
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
              {openingBalance.weight && <div><span className="text-gray-400 text-xs">Weight</span><p className="font-semibold">{openingBalance.weight}</p></div>}
              {openingBalance.grayMtr && <div><span className="text-gray-400 text-xs">Gray Mtr</span><p className="font-semibold">{openingBalance.grayMtr}</p></div>}
              {openingBalance.quality && <div><span className="text-gray-400 text-xs">Quality</span><p>{openingBalance.quality}</p></div>}
            </div>
            <EditCarryForward lotNo={lotNo} weight={openingBalance.weight} grayMtr={openingBalance.grayMtr} />

            {/* Stage allocations (dyed / finished / packed) */}
            <EditAllocations
              balanceId={openingBalance.id}
              openingThan={openingBalance.openingThan}
              initialAllocations={openingBalance.allocations || []}
            />

            {/* Previous year despatch history */}
            {openingBalance.despatchHistory?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-2">Previous Year Despatch</p>
                <div className="space-y-1">
                  {openingBalance.despatchHistory.map((d: any) => (
                    <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                      {d.date && <span className="text-gray-500">{fmt(d.date)}</span>}
                      <span>Ch: {d.challanNo}</span>
                      <span className="font-semibold">{d.than} than</span>
                      {d.billNo && <span>Bill: {d.billNo}</span>}
                      {d.rate && <span>@ &#8377;{d.rate}</span>}
                      {d.than && d.rate && <span className="text-gray-500">= &#8377;{(d.than * d.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>}
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
            {greyEntries.map((e: any) => (
              <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {e.sn != null && (
                  <span className="text-gray-400 text-xs font-medium">
                    SN {e.sn < 0 ? `O${Math.abs(e.sn)}` : e.sn}
                  </span>
                )}
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">🎨 Dyeing Slip ({dyeingEntries.length})</h2>
            <ShareDyeingPDFButton lotNo={lotNo} slips={dyeingEntries.filter((e: any) => !e._isOB).map((e: any) => ({
              slipNo: e.slipNo,
              date: e.date?.toISOString ? e.date.toISOString() : e.date,
              shadeName: e.shadeName || null,
              lots: (e.lots?.length ? e.lots : [{ lotNo: e.lotNo || lotNo, than: e._lotThan ?? e.than }]).map((l: any) => ({ lotNo: l.lotNo, than: l.than })),
              chemicals: (e.chemicals || []).map((c: any) => ({ name: c.name || c.chemical?.name || '', quantity: c.quantity, unit: c.unit, rate: c.rate, cost: c.cost, processTag: c.processTag || null })),
              notes: e.notes || null,
              status: e.status || null,
              machine: e.machine?.name || null,
              operator: e.operator?.name || null,
              totalRounds: e.totalRounds || null,
            }))} />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50">
            {dyeingEntries.map((e: any) => {
              const lotThan = e._lotThan ?? e.than
              const totalCost = e.chemicals?.reduce((s: number, c: any) => s + (c.cost ?? 0), 0) ?? 0
              return (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-500 text-xs">{fmt(e.date)}</span>
                    {e._isOB ? (
                      <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">OB Carry-Forward</span>
                    ) : (
                      <Link href={`/dyeing/${e.id}`} className="text-purple-600 font-medium hover:underline">
                        Slip {e.slipNo}
                      </Link>
                    )}
                    <span className="font-semibold text-purple-700">Than: {lotThan}</span>
                    {totalCost > 0 && <span className="text-xs text-gray-500">Cost: ₹{totalCost.toFixed(0)}</span>}
                  </div>
                  {!e._isOB && e.lots?.length > 1 && (
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
                    {e._isOB || e.slipNo === 0 ? (
                      <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">OB Carry-Forward</span>
                    ) : (
                      <Link href={`/finish/${e.id}`} className="text-teal-600 font-medium hover:underline">
                        FP {e.slipNo}
                      </Link>
                    )}
                    <span className="font-semibold text-teal-700">Than: {lotThan}</span>
                    {lotMeter != null && lotMeter > 0 && <span className="text-xs text-gray-500">Meter: {lotMeter}</span>}
                    {totalCost > 0 && <span className="text-xs text-gray-500">Cost: &#8377;{totalCost.toFixed(0)}</span>}
                    {e.finishDespSlipNo && (
                      <span className="text-xs font-medium text-teal-600 bg-teal-50 dark:bg-teal-900/30 dark:text-teal-300 px-1.5 py-0.5 rounded">
                        Desp Slip: {e.finishDespSlipNo}
                      </span>
                    )}
                  </div>
                  {!e._isOB && e.lots?.length > 1 && (
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

      {/* Folding Receipts */}
      {foldingReceipts.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">📋 Folding Receipt ({foldingReceipts.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
            {foldingReceipts.map((e: any) => (
              <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-gray-500 text-xs">{fmt(e.date)}</span>
                <span className="text-amber-600 font-medium">FR {e.slipNo}</span>
                <span className="font-semibold text-amber-700 dark:text-amber-300">Than: {e.than}</span>
                {e.notes && <span className="text-xs text-gray-400">{e.notes}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Packing entries */}
      {packingEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">📦 Packing ({packingEntries.length})</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
            {packingEntries.map((e: any) => (
              <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-gray-500 text-xs">{fmt(e.date)}</span>
                {e._isOB ? (
                  <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">OB Carry-Forward</span>
                ) : (
                  <>
                    <span className="text-pink-600 font-medium">{e.packingNo}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      e.status === 'confirmed'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>{e.status}</span>
                  </>
                )}
                <span className="font-semibold text-pink-700 dark:text-pink-300">Than: {e._lotThan}</span>
                {e._lotBoxes != null && e._lotBoxes > 0 && <span className="text-xs text-gray-500">Boxes: {e._lotBoxes}</span>}
                {e.notes && <span className="text-xs text-gray-400">{e.notes}</span>}
              </div>
            ))}
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

      {/* Re-Process history */}
      {reproEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">🔄 Re-Process</h2>
          <div className="space-y-2">
            {reproEntries.map((r: any, i: number) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-purple-200 dark:border-purple-800 shadow-sm p-4">
                {r.type === 'source' ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-purple-700 dark:text-purple-400">{r.reprocess?.reproNo}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${r.reprocess?.status === 'merged' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'}`}>{r.reprocess?.status}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Sent <strong>{r.than}</strong> for re-process ({r.reason || r.reprocess?.reason}) · Quality: {r.reprocess?.quality}
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-purple-700 dark:text-purple-400">{r.reproNo}</span>
                      <span className="text-sm font-bold text-emerald-600">{r.totalThan}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{r.quality} · {r.reason} · {r.sources?.length} source lot{r.sources?.length !== 1 ? 's' : ''}</p>
                    {r.sources?.map((s: any) => (
                      <p key={s.id} className="text-xs text-gray-500 ml-2">← {s.originalLotNo} ({s.than}) {s.party}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!openingBalance && greyEntries.length === 0 && despatchEntries.length === 0 && dyeingEntries.length === 0 && finishEntries.length === 0 && foldEntries.length === 0 && foldingReceipts.length === 0 && packingEntries.length === 0 && reproEntries.length === 0 && (
        <div className="text-center text-gray-400 py-16">No records found for lot <strong>{lotNo}</strong></div>
      )}
    </div>
  )
}
