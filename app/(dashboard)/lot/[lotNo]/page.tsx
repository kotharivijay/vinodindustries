import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'

export default async function LotTrackPage({ params }: { params: { lotNo: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const lotNo = decodeURIComponent(params.lotNo)

  const [greyEntries, despatchEntries, dyeingEntries] = await Promise.all([
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
    prisma.dyeingEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      orderBy: { date: 'asc' },
    }),
  ])

  const greyThan = greyEntries.reduce((s, e) => s + e.than, 0)
  const despatchThan = despatchEntries.reduce((s, e) => s + e.than, 0)
  const dyeingThan = dyeingEntries.reduce((s, e) => s + e.than, 0)
  const stock = greyThan - despatchThan

  const fmt = (d: Date) => new Date(d).toLocaleDateString('en-IN')

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/grey" className="text-gray-500 hover:text-gray-800 text-sm">← Back</Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Lot Track: <span className="text-indigo-600">{lotNo}</span></h1>
          <p className="text-sm text-gray-500 mt-0.5">Full process history for this lot</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Grey Inward</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{greyThan}</p>
          <p className="text-xs text-gray-400">{greyEntries.length} entries</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Dyeing</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">{dyeingThan}</p>
          <p className="text-xs text-gray-400">{dyeingEntries.length} entries</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Despatched</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">{despatchThan}</p>
          <p className="text-xs text-gray-400">{despatchEntries.length} entries</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Balance</p>
          <p className={`text-2xl font-bold mt-1 ${stock > 0 ? 'text-green-600' : stock < 0 ? 'text-red-600' : 'text-gray-400'}`}>{stock}</p>
          <p className="text-xs text-gray-400">in stock</p>
        </div>
      </div>

      {/* Grey entries */}
      {greyEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">📦 Grey Inward ({greyEntries.length})</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
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

      {/* Dyeing entries */}
      {dyeingEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">🎨 Dyeing Slip ({dyeingEntries.length})</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {dyeingEntries.map(e => (
              <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-gray-500 text-xs">{fmt(e.date)}</span>
                <span className="text-gray-600">Slip: {e.slipNo}</span>
                <span className="font-semibold text-purple-700">Than: {e.than}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Despatch entries */}
      {despatchEntries.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">🚚 Despatch ({despatchEntries.length})</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
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

      {greyEntries.length === 0 && despatchEntries.length === 0 && dyeingEntries.length === 0 && (
        <div className="text-center text-gray-400 py-16">No records found for lot <strong>{lotNo}</strong></div>
      )}
    </div>
  )
}
