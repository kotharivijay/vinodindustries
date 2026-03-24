'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats { greyEntries: number; despatchEntries: number; totalDespatched: number; currentStock: number; parties: number }

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/stats').then((r) => r.json()).then(setStats)
  }, [])

  const cards = [
    { label: 'Total Grey Entries', value: stats?.greyEntries, color: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', href: '' },
    { label: 'Despatch Entries', value: stats?.despatchEntries, color: 'bg-green-500', bg: 'bg-green-50', text: 'text-green-700', href: '' },
    { label: 'Balance Stock (Than)', value: stats?.currentStock, color: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', href: '/stock' },
    { label: 'Active Parties', value: stats?.parties, color: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-700', href: '' },
  ]

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-500 mt-1">Here&apos;s your overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {cards.map((c) => {
          const inner = (
            <>
              <div className={`w-10 h-10 ${c.bg} rounded-lg flex items-center justify-center mb-4`}>
                <div className={`w-4 h-4 ${c.color} rounded-sm`} />
              </div>
              <p className={`text-2xl font-bold ${c.text}`}>
                {stats === null ? '...' : (c.value ?? 0).toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 mt-1">{c.label}</p>
            </>
          )
          return c.href ? (
            <Link key={c.label} href={c.href} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 hover:shadow-md hover:border-gray-200 transition cursor-pointer block">
              {inner}
            </Link>
          ) : (
            <div key={c.label} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              {inner}
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link href="/grey" className="flex items-center justify-between p-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition">
              <span className="text-sm font-medium text-blue-700">Grey Inward List</span>
              <span className="text-blue-400">→</span>
            </Link>
            <Link href="/grey/new" className="flex items-center justify-between p-3 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition">
              <span className="text-sm font-medium text-indigo-700">+ New Grey Entry</span>
              <span className="text-indigo-400">→</span>
            </Link>
            <Link href="/despatch/new" className="flex items-center justify-between p-3 bg-green-50 rounded-lg hover:bg-green-100 transition">
              <span className="text-sm font-medium text-green-700">+ New Despatch</span>
              <span className="text-green-400">→</span>
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-4">System Status</h2>
          <div className="space-y-3 text-sm">
            {[
              { label: 'Authentication', status: 'Active', color: 'bg-green-100 text-green-700' },
              { label: 'Database', status: 'Connected', color: 'bg-green-100 text-green-700' },
              { label: 'Grey Module', status: 'Live', color: 'bg-green-100 text-green-700' },
              { label: 'Despatch Module', status: 'Live', color: 'bg-green-100 text-green-700' },
            ].map((s) => (
              <div key={s.label} className="flex justify-between items-center">
                <span className="text-gray-600">{s.label}</span>
                <span className={`${s.color} px-2 py-0.5 rounded-full text-xs font-medium`}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
