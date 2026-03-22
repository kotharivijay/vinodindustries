'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SignOutButton from './SignOutButton'

interface Props {
  userName?: string | null
  userEmail?: string | null
}

const navGroups = [
  { label: null, links: [{ href: '/dashboard', label: 'Dashboard', icon: '🏠' }] },
  {
    label: 'Modules',
    links: [
      { href: '/grey', label: 'Grey Inward', icon: '📦' },
      { href: '/despatch', label: 'Despatch', icon: '🚚' },
      { href: '/dyeing', label: 'Dyeing Slip', icon: '🎨' },
      { href: '/finish', label: 'Finish/Center', icon: '✨' },
    ],
  },
  {
    label: 'Masters',
    links: [
      { href: '/masters/parties', label: 'Parties', icon: '👥' },
      { href: '/masters/qualities', label: 'Qualities', icon: '🏷️' },
      { href: '/masters/weavers', label: 'Weavers', icon: '🧵' },
      { href: '/masters/transports', label: 'Transports', icon: '🚛' },
      { href: '/masters/chemicals', label: 'Chemicals', icon: '🧪' },
    ],
  },
]

function SidebarContent({ pathname, onNavigate, userName, userEmail }: {
  pathname: string
  onNavigate: () => void
  userName?: string | null
  userEmail?: string | null
}) {
  const initial = userName?.[0]?.toUpperCase() ?? 'U'
  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="p-5 border-b border-gray-700">
        <h1 className="text-lg font-bold tracking-tight">Vinod Industries</h1>
        <p className="text-xs text-gray-400 mt-0.5">Textile Management</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'pt-3' : ''}>
            {group.label && (
              <p className="text-[10px] text-gray-500 uppercase tracking-widest px-3 mb-1.5 font-semibold">
                {group.label}
              </p>
            )}
            {group.links.map(link => {
              const active = pathname === link.href || pathname.startsWith(link.href + '/')
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition font-medium ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <span className="text-base leading-none">{link.icon}</span>
                  {link.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{userName}</p>
            <p className="text-xs text-gray-400 truncate">{userEmail}</p>
          </div>
        </div>
        <SignOutButton />
      </div>
    </div>
  )
}

export default function Sidebar({ userName, userEmail }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close drawer on route change
  useEffect(() => { setOpen(false) }, [pathname])

  // Prevent body scroll when drawer open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* ── MOBILE TOP BAR ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-30 bg-gray-900 text-white flex items-center gap-3 px-4 h-14 shadow-lg">
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 rounded-lg hover:bg-gray-700 transition"
          aria-label="Open menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="font-bold text-base">Vinod Industries</span>
      </header>

      {/* ── MOBILE DRAWER OVERLAY ── */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Drawer */}
          <aside className="relative z-50 w-72 bg-gray-900 text-white flex flex-col shadow-2xl animate-slide-in">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition"
              aria-label="Close menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setOpen(false)}
              userName={userName}
              userEmail={userEmail}
            />
          </aside>
        </div>
      )}

      {/* ── DESKTOP SIDEBAR ── */}
      <aside className="hidden md:flex md:w-64 bg-gray-900 text-white flex-col flex-shrink-0">
        <SidebarContent
          pathname={pathname}
          onNavigate={() => {}}
          userName={userName}
          userEmail={userEmail}
        />
      </aside>
    </>
  )
}
