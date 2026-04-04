'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SignOutButton from './SignOutButton'
import NotificationBell from './NotificationBell'
import { useTheme } from '../theme-provider'

interface Props {
  userName?: string | null
  userEmail?: string | null
}

const ksiNavGroups = [
  { label: null, links: [{ href: '/dashboard', label: 'Dashboard', icon: '🏠' }] },
  {
    label: 'Modules',
    links: [
      { href: '/grey', label: 'Grey Inward', icon: '📦' },
      { href: '/grey/weights', label: 'Update Weights', icon: '⚖️' },
      { href: '/despatch', label: 'Despatch', icon: '🚚' },
      { href: '/dyeing', label: 'Dyeing Slip', icon: '🎨' },
      { href: '/dyeing/batch', label: 'Dyeing (Batch)', icon: '🧫' },
      { href: '/dyeing/pc', label: 'PC Dyeing', icon: '🏭' },
      { href: '/dyeing/color-lab', label: 'Color Lab', icon: '🎨' },
      { href: '/finish', label: 'Finish/Center', icon: '✨' },
      { href: '/stock', label: 'Stock Summary', icon: '📊' },
      { href: '/fold', label: 'Fold Program', icon: '🪡' },
      { href: '/fold/pc', label: 'PC Fold', icon: '📋' },
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
      { href: '/masters/shades', label: 'Shades', icon: '🎨' },
      { href: '/masters/shades/import', label: 'Shade Import', icon: '📥' },
      { href: '/masters/machines', label: 'Machine Master', icon: '⚙️' },
      { href: '/masters/operators', label: 'Operator Master', icon: '👷' },
      { href: '/masters/processes', label: 'Process Master', icon: '🔬' },
    ],
  },
  {
    label: 'Accounts',
    links: [
      { href: '/ksi/tally', label: 'Tally Dashboard', icon: '📊' },
      { href: '/ksi/outstanding', label: 'Outstanding', icon: '💰' },
      { href: '/ksi/sales', label: 'Sales Register', icon: '📈' },
      { href: '/ksi/ledgers', label: 'Ledger Master', icon: '📒' },
    ],
  },
  {
    label: 'Vault',
    links: [
      { href: '/vault', label: 'Document Vault', icon: '🔒' },
    ],
  },
  {
    label: 'Settings',
    links: [
      { href: '/settings', label: 'Settings', icon: '⚙️' },
    ],
  },
]

const viNavGroups = [
  { label: null, links: [{ href: '/vi/dashboard', label: 'Dashboard', icon: '🏠' }] },
  {
    label: 'Modules',
    links: [
      { href: '/vi/tally', label: 'Tally Dashboard', icon: '📊' },
      { href: '/vi/ledgers', label: 'Ledger Master', icon: '📒' },
      { href: '/vi/outstanding', label: 'Outstanding', icon: '💰' },
      { href: '/vi/sales', label: 'Sales Register', icon: '📈' },
      { href: '/vi/orders', label: 'Orders', icon: '📋' },
      { href: '/vi/contacts', label: 'Contacts', icon: '👥' },
      { href: '/vi/calls', label: 'Call Reminders', icon: '🔔' },
    ],
  },
  {
    label: 'Settings',
    links: [
      { href: '/vi/settings', label: 'Tally Settings', icon: '⚙️' },
    ],
  },
]

// Sidebar customization types
interface SidebarCustomization {
  renames: Record<string, string>    // href → custom label
  hidden: string[]                    // hrefs to hide
  order: string[]                     // ordered hrefs (flat, across groups)
}

const SIDEBAR_STORAGE_KEY = 'sidebar-customization'

function loadCustomization(company: string): SidebarCustomization {
  try {
    const raw = localStorage.getItem(`${SIDEBAR_STORAGE_KEY}-${company}`)
    if (raw) return { renames: {}, hidden: [], order: [], ...JSON.parse(raw) }
  } catch {}
  return { renames: {}, hidden: [], order: [] }
}

function saveCustomization(company: string, c: SidebarCustomization) {
  localStorage.setItem(`${SIDEBAR_STORAGE_KEY}-${company}`, JSON.stringify(c))
}

function SidebarContent({ pathname, onNavigate, userName, userEmail, company }: {
  pathname: string
  onNavigate: () => void
  userName?: string | null
  userEmail?: string | null
  company: string
}) {
  const initial = userName?.[0]?.toUpperCase() ?? 'U'
  const { theme, toggle } = useTheme()
  const companyName = company === 'vi' ? 'Vinod Industries' : 'Kothari Synthetic Industries'
  const companyIcon = company === 'vi' ? '\u{1F3E2}' : '\u{1F3ED}'
  const defaultGroups = company === 'vi' ? viNavGroups : ksiNavGroups

  const [editMode, setEditMode] = useState(false)
  const [custom, setCustom] = useState<SidebarCustomization>({ renames: {}, hidden: [], order: [] })
  const [renamingHref, setRenamingHref] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    setCustom(loadCustomization(company))
  }, [company])

  const save = (c: SidebarCustomization) => {
    setCustom(c)
    saveCustomization(company, c)
  }

  // Build flat list of all links with their group
  const allLinks = defaultGroups.flatMap(g => g.links.map(l => ({ ...l, group: g.label })))

  // Apply customization: order, renames, hidden
  const getLabel = (href: string, defaultLabel: string) => custom.renames[href] || defaultLabel
  const isHidden = (href: string) => custom.hidden.includes(href)

  const moveUp = (href: string, groupLabel: string | null) => {
    const group = defaultGroups.find(g => g.label === groupLabel)
    if (!group) return
    const links = [...group.links]
    const idx = links.findIndex(l => l.href === href)
    if (idx <= 0) return
    ;[links[idx - 1], links[idx]] = [links[idx], links[idx - 1]]
    group.links = links
    // Store order as flat array
    const flatOrder = defaultGroups.flatMap(g => g.links.map(l => l.href))
    save({ ...custom, order: flatOrder })
  }

  const moveDown = (href: string, groupLabel: string | null) => {
    const group = defaultGroups.find(g => g.label === groupLabel)
    if (!group) return
    const links = [...group.links]
    const idx = links.findIndex(l => l.href === href)
    if (idx < 0 || idx >= links.length - 1) return
    ;[links[idx], links[idx + 1]] = [links[idx + 1], links[idx]]
    group.links = links
    const flatOrder = defaultGroups.flatMap(g => g.links.map(l => l.href))
    save({ ...custom, order: flatOrder })
  }

  const toggleHidden = (href: string) => {
    const hidden = isHidden(href)
      ? custom.hidden.filter(h => h !== href)
      : [...custom.hidden, href]
    save({ ...custom, hidden })
  }

  const startRename = (href: string, currentLabel: string) => {
    setRenamingHref(href)
    setRenameValue(currentLabel)
  }

  const finishRename = () => {
    if (renamingHref && renameValue.trim()) {
      const defaultLabel = allLinks.find(l => l.href === renamingHref)?.label ?? ''
      if (renameValue.trim() === defaultLabel) {
        // Same as default — remove custom rename
        const renames = { ...custom.renames }
        delete renames[renamingHref]
        save({ ...custom, renames })
      } else {
        save({ ...custom, renames: { ...custom.renames, [renamingHref]: renameValue.trim() } })
      }
    }
    setRenamingHref(null)
    setRenameValue('')
  }

  const resetAll = () => {
    save({ renames: {}, hidden: [], order: [] })
  }

  // Apply order if saved
  const navGroups = defaultGroups.map(g => {
    if (custom.order.length === 0) return g
    const ordered = [...g.links].sort((a, b) => {
      const ai = custom.order.indexOf(a.href)
      const bi = custom.order.indexOf(b.href)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return { ...g, links: ordered }
  })

  return (
    <div className="flex flex-col h-full">
      {/* Brand + Company */}
      <div className="p-5 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{companyIcon}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">{companyName}</h1>
            <p className="text-[10px] text-gray-400 mt-0.5">Textile Management</p>
          </div>
          <NotificationBell />
        </div>
        <div className="flex gap-2 mt-2">
          <Link href="/select-company" className="flex-1 flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5 transition">
            Switch
          </Link>
          <button
            onClick={() => setEditMode(!editMode)}
            className={`flex items-center justify-center gap-1 text-xs rounded-lg px-3 py-1.5 transition ${
              editMode ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700'
            }`}
          >
            {editMode ? '✓ Done' : '✏️ Edit'}
          </button>
        </div>
      </div>

      {/* Edit mode header */}
      {editMode && (
        <div className="px-3 pt-2">
          <button onClick={resetAll} className="text-[10px] text-red-400 hover:text-red-300 underline">
            Reset to Default
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'pt-3' : ''}>
            {group.label && (
              <p className="text-[10px] text-gray-500 uppercase tracking-widest px-3 mb-1.5 font-semibold">
                {group.label}
              </p>
            )}
            {group.links.map((link, li) => {
              const hidden = isHidden(link.href)
              if (hidden && !editMode) return null
              const label = getLabel(link.href, link.label)
              const active = pathname === link.href || pathname.startsWith(link.href + '/')

              if (editMode) {
                return (
                  <div key={link.href} className={`flex items-center gap-1 px-1 py-1 rounded-lg ${hidden ? 'opacity-40' : ''}`}>
                    {/* Up/Down */}
                    <div className="flex flex-col">
                      <button onClick={() => moveUp(link.href, group.label)} disabled={li === 0}
                        className="text-[10px] text-gray-500 hover:text-white disabled:opacity-20 leading-none">▲</button>
                      <button onClick={() => moveDown(link.href, group.label)} disabled={li === group.links.length - 1}
                        className="text-[10px] text-gray-500 hover:text-white disabled:opacity-20 leading-none">▼</button>
                    </div>
                    {/* Icon + Label */}
                    <span className="text-sm leading-none">{link.icon}</span>
                    {renamingHref === link.href ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={finishRename}
                        onKeyDown={e => { if (e.key === 'Enter') finishRename() }}
                        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    ) : (
                      <span className="flex-1 text-xs text-gray-300 truncate">{label}</span>
                    )}
                    {/* Rename */}
                    {renamingHref !== link.href && (
                      <button onClick={() => startRename(link.href, label)}
                        className="text-[10px] text-gray-500 hover:text-indigo-400" title="Rename">✏️</button>
                    )}
                    {/* Hide/Show */}
                    <button onClick={() => toggleHidden(link.href)}
                      className={`text-[10px] ${hidden ? 'text-red-400 hover:text-green-400' : 'text-gray-500 hover:text-red-400'}`}
                      title={hidden ? 'Show' : 'Hide'}>
                      {hidden ? '👁️' : '🚫'}
                    </button>
                  </div>
                )
              }

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
                  {label}
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
        <div className="flex gap-2 mb-2">
          <button
            onClick={toggle}
            className="flex-1 flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 transition"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
        </div>
        <SignOutButton />
      </div>
    </div>
  )
}

export default function Sidebar({ userName, userEmail }: Props) {
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState<string>('ksi')
  const pathname = usePathname()
  const { theme, toggle } = useTheme()

  // Read selected company from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('selectedCompany')
    if (saved) setCompany(saved)
  }, [])

  const companyName = company === 'vi' ? 'Vinod Industries' : 'Kothari Synthetic Industries'

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
        <span className="font-bold text-base flex-1 truncate">{companyName}</span>
        <NotificationBell />
        <button onClick={toggle} className="text-lg shrink-0" title="Toggle dark mode">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <Link href="/select-company" className="text-[10px] text-gray-400 hover:text-white bg-gray-800 rounded px-2 py-1 shrink-0">Switch</Link>
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
              company={company}
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
          company={company}
        />
      </aside>
    </>
  )
}
