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
    { label: 'Total Grey Entries', value: stats?.greyEntries, color: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400', href: '' },
    { label: 'Despatch Entries', value: stats?.despatchEntries, color: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', href: '' },
    { label: 'Balance Stock (Than)', value: stats?.currentStock, color: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', href: '/stock' },
    { label: 'Active Parties', value: stats?.parties, color: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-400', href: '' },
  ]

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Here&apos;s your overview</p>
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
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{c.label}</p>
            </>
          )
          return c.href ? (
            <Link key={c.label} href={c.href} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-700 hover:shadow-md hover:border-gray-200 dark:hover:border-gray-600 transition cursor-pointer block">
              {inner}
            </Link>
          ) : (
            <div key={c.label} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-700">
              {inner}
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link href="/grey" className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-400">Grey Inward List</span>
              <span className="text-blue-400">→</span>
            </Link>
            <Link href="/grey/new" className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-400">+ New Grey Entry</span>
              <span className="text-indigo-400">→</span>
            </Link>
            <Link href="/despatch/new" className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition">
              <span className="text-sm font-medium text-green-700 dark:text-green-400">+ New Despatch</span>
              <span className="text-green-400">→</span>
            </Link>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">System Status</h2>
          <div className="space-y-3 text-sm">
            {[
              { label: 'Authentication', status: 'Active', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
              { label: 'Database', status: 'Connected', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
              { label: 'Grey Module', status: 'Live', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
              { label: 'Despatch Module', status: 'Live', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
            ].map((s) => (
              <div key={s.label} className="flex justify-between items-center">
                <span className="text-gray-600 dark:text-gray-300">{s.label}</span>
                <span className={`${s.color} px-2 py-0.5 rounded-full text-xs font-medium`}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
