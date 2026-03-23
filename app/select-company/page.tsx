'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const companies = [
  { id: 'ksi', name: 'Kothari Synthetic Industries', code: 'KSI', icon: '\u{1F3ED}', href: '/dashboard', comingSoon: false },
  { id: 'vi', name: 'Vinod Industries', code: 'VI', icon: '\u{1F3E2}', href: '/vi/dashboard', comingSoon: true },
]

export default function SelectCompanyPage() {
  const router = useRouter()
  const [selecting, setSelecting] = useState<string | null>(null)

  function handleSelect(company: typeof companies[0]) {
    if (company.comingSoon) return
    setSelecting(company.id)
    localStorage.setItem('selectedCompany', company.id)
    router.push(company.href)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">Select Company</h1>
          <p className="text-sm text-gray-500 mt-1">Choose a company to continue</p>
        </div>

        <div className="space-y-4">
          {companies.map(c => (
            <button
              key={c.id}
              onClick={() => handleSelect(c)}
              disabled={c.comingSoon || selecting === c.id}
              className={`w-full text-left bg-white rounded-2xl shadow-sm border-2 p-6 transition ${
                c.comingSoon
                  ? 'border-gray-200 opacity-60 cursor-not-allowed'
                  : selecting === c.id
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-purple-400 hover:shadow-md cursor-pointer'
              }`}
            >
              <div className="flex items-center gap-4">
                <span className="text-4xl">{c.icon}</span>
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-gray-800">{c.name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Code: {c.code}</p>
                </div>
                {c.comingSoon && (
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">Coming Soon</span>
                )}
                {selecting === c.id && (
                  <span className="text-sm text-purple-600 animate-pulse">Loading...</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
