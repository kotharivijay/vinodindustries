'use client'

import { useState, useEffect, useLayoutEffect, useRef, type Ref } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SignOutButton from './SignOutButton'
import NotificationBell from './NotificationBell'
import { useTheme } from '../theme-provider'

interface Props {
  userName?: string | null
  userEmail?: string | null
  role?: 'admin' | 'ksi'
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
      { href: '/dyeing/reprocess', label: 'Re-Process', icon: '🔄' },
      { href: '/dyeing/color-lab', label: 'Color Lab', icon: '🎨' },
      { href: '/finish', label: 'Finish/Center', icon: '✨' },
      { href: '/stock', label: 'Stock Summary', icon: '📊' },
      { href: '/fold', label: 'Fold Program', icon: '🪡' },
      { href: '/camera', label: 'Machine Camera', icon: '📹' },
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
      { href: '/masters/process-rates', label: 'Process Rates', icon: '💱' },
      { href: '/masters/finish-recipe', label: 'Finish Recipe', icon: '📋' },
    ],
  },
  {
    label: 'Reports',
    links: [
      { href: '/reports/party-stock', label: 'Party Stock Report', icon: '📦' },
      { href: '/reports/invoice-payment-performance', label: 'Invoice Payment Performance', icon: '⏱️' },
      { href: '/dyeing/cost-report', label: 'Dyeing Cost Report', icon: '📊' },
      { href: '/dyeing/production-report', label: 'Production Report', icon: '🏭' },
      { href: '/dyeing/consumption-report', label: 'Consumption Report', icon: '🧪' },
    ],
  },
  {
    label: 'Accounts',
    links: [
      { href: '/ksi/tally', label: 'Tally Dashboard', icon: '📊' },
      { href: '/accounts/receipts', label: 'Receipts (HDFC)', icon: '🏦' },
      { href: '/accounts/sales', label: 'Sales / Process Register', icon: '📈' },
      { href: '/accounts/outstanding', label: 'Outstanding', icon: '💰' },
      { href: '/accounts/ledger', label: 'Party Ledger', icon: '📜' },
      { href: '/ksi/ledgers', label: 'Ledger Master', icon: '📒' },
      { href: '/ksi/ledger-tags', label: 'Ledger Tags', icon: '🏷️' },
    ],
  },
  {
    label: 'Vault',
    links: [
      { href: '/vault', label: 'Document Vault', icon: '🔒' },
    ],
  },
  {
    label: 'Inventory',
    links: [
      { href: '/inventory', label: 'Hub', icon: '🏠' },
      { href: '/inventory/challans', label: 'Inward Challans', icon: '📥' },
      { href: '/inventory/po', label: 'Purchase Orders', icon: '📝' },
      { href: '/inventory/invoices', label: 'Purchase Invoices', icon: '🧾' },
      { href: '/inventory/items', label: 'Items Master', icon: '📦' },
      { href: '/inventory/parties', label: 'Parties', icon: '👥' },
      { href: '/inventory/aliases', label: 'Tally Aliases', icon: '🏷️' },
      { href: '/inventory/config', label: 'Tally Config', icon: '⚙️' },
    ],
  },
  {
    label: 'Archive',
    links: [
      { href: '/dyeing/pc', label: 'PC Dyeing', icon: '🏭' },
      { href: '/dyeing/program', label: 'Dyeing Program', icon: '📋' },
      { href: '/fold/pc', label: 'PC Fold', icon: '📋' },
    ],
  },
  {
    label: 'Admin',
    links: [
      { href: '/attendance', label: 'Attendance', icon: '🕒' },
      { href: '/attendance/employees', label: 'Employees (tag left)', icon: '👥' },
      { href: '/backup', label: 'DB Backup (Neon)', icon: '💾' },
      { href: '/delete-log', label: 'Delete Log', icon: '🗑️' },
    ],
  },
  {
    label: 'Payroll',
    links: [
      { href: '/payroll', label: 'Overview', icon: '📋' },
      { href: '/payroll/wages', label: 'Wages Register', icon: '💸' },
      { href: '/payroll/register', label: 'Salary Register', icon: '📊' },
      { href: '/payroll/staff', label: 'Staff Directory', icon: '👥' },
      { href: '/payroll/contractors', label: 'Contractors', icon: '👷' },
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
    label: 'Payroll',
    links: [
      { href: '/payroll', label: 'Overview', icon: '📋' },
      { href: '/payroll/wages', label: 'Wages Register', icon: '💸' },
      { href: '/payroll/register', label: 'Salary Register', icon: '📊' },
      { href: '/payroll/staff', label: 'Staff Directory', icon: '👥' },
      { href: '/payroll/contractors', label: 'Contractors', icon: '👷' },
    ],
  },
  {
    label: 'Settings',
    links: [
      { href: '/vi/settings', label: 'Tally Settings', icon: '⚙️' },
    ],
  },
]

type WidthMode = 'full' | 'rail' | 'hover'

// Sidebar customization types
interface SidebarCustomization {
  renames: Record<string, string>    // href → custom label
  hidden: string[]                    // hrefs to hide
  order: string[]                     // ordered hrefs (flat, across groups)
  widthMode?: WidthMode               // desktop aside width behavior (default 'full')
  accordion?: boolean                 // one nav group open at a time (default false)
  search?: boolean                    // show the filter field (default false)
  slidingIndicator?: boolean          // animate a single pill to the active row (default true)
  pinned?: string[]                   // pinned hrefs, rendered in a ⭐ Pinned section
}

const DEFAULT_CUSTOM: SidebarCustomization = {
  renames: {},
  hidden: [],
  order: [],
  widthMode: 'full',
  accordion: false,
  search: false,
  slidingIndicator: true,
  pinned: [],
}

const SIDEBAR_STORAGE_KEY = 'sidebar-customization'

function loadCustomization(company: string): SidebarCustomization {
  try {
    const raw = localStorage.getItem(`${SIDEBAR_STORAGE_KEY}-${company}`)
    if (raw) return { ...DEFAULT_CUSTOM, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_CUSTOM }
}

function saveCustomization(company: string, c: SidebarCustomization) {
  localStorage.setItem(`${SIDEBAR_STORAGE_KEY}-${company}`, JSON.stringify(c))
}

type NavLink = { href: string; label: string; icon: string }
type Flyout = { label: string; top: number; left: number }

// ── A single navigation row (non-edit mode) ──────────────────────────
function NavRow({
  link,
  label,
  active,
  expanded,
  usePill,
  slidingOn,
  onNavigate,
  setFlyout,
  pinControl,
  pinAlwaysVisible,
  rowRef,
}: {
  link: NavLink
  label: string
  active: boolean
  expanded: boolean
  usePill: boolean
  slidingOn: boolean
  onNavigate: () => void
  setFlyout?: (f: Flyout | null) => void
  pinControl?: { pinned: boolean; toggle: () => void } | null
  pinAlwaysVisible?: boolean
  rowRef?: Ref<HTMLAnchorElement>
}) {
  const layout = expanded ? 'gap-3 px-3 py-2.5' : 'justify-center py-2.5'
  const state =
    active && usePill
      ? 'bg-transparent text-[var(--sidebar-active-text)]'
      : active
      ? 'bg-indigo-600 text-white'
      : 'text-[var(--sidebar-text-secondary)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text)]'

  return (
    <Link
      ref={rowRef}
      href={link.href}
      onClick={onNavigate}
      title={!expanded ? label : undefined}
      onMouseEnter={(e) => {
        if (!expanded && setFlyout) {
          const r = e.currentTarget.getBoundingClientRect()
          setFlyout({ label, top: r.top + r.height / 2, left: r.right + 10 })
        }
      }}
      onMouseLeave={() => { if (!expanded && setFlyout) setFlyout(null) }}
      className={`group/navrow relative flex items-center rounded-lg text-sm font-medium transition ${layout} ${state} ${slidingOn ? 'z-10' : ''}`}
    >
      <span className="text-base leading-none w-5 text-center flex-shrink-0">{link.icon}</span>
      {expanded && <span className="flex-1 truncate">{label}</span>}
      {expanded && pinControl && (
        <span
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); pinControl.toggle() }}
          title={pinControl.pinned ? 'Unpin' : 'Pin to top'}
          className={`flex-shrink-0 text-[13px] cursor-pointer transition-opacity ${
            pinControl.pinned
              ? 'opacity-100'
              : pinAlwaysVisible
              ? 'opacity-50 hover:opacity-100'
              : 'opacity-0 group-hover/navrow:opacity-50 hover:!opacity-100'
          }`}
        >
          {pinControl.pinned ? '⭐' : '☆'}
        </span>
      )}
    </Link>
  )
}

function SidebarContent({
  pathname,
  onNavigate,
  userName,
  userEmail,
  company,
  role = 'admin',
  custom,
  save,
  expanded,
  widthMode,
  desktop,
  pinOpen,
  setPinOpen,
}: {
  pathname: string
  onNavigate: () => void
  userName?: string | null
  userEmail?: string | null
  company: string
  role?: 'admin' | 'ksi'
  custom: SidebarCustomization
  save: (c: SidebarCustomization) => void
  expanded: boolean
  widthMode: WidthMode
  desktop: boolean
  pinOpen: boolean
  setPinOpen: (v: boolean) => void
}) {
  const initial = userName?.[0]?.toUpperCase() ?? 'U'
  const { theme, toggle } = useTheme()
  const companyName = company === 'vi' ? 'Vinod Industries' : 'Kothari Synthetic Industries'
  const companyIcon = company === 'vi' ? '\u{1F3E2}' : '\u{1F3ED}'
  const baseGroups = company === 'vi' ? viNavGroups : ksiNavGroups
  // KSI role: hide Vault and Accounts sections
  const defaultGroups = role === 'ksi'
    ? baseGroups.filter(g => g.label !== 'Vault' && g.label !== 'Accounts')
    : baseGroups

  const [editMode, setEditMode] = useState(false)
  const [renamingHref, setRenamingHref] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [query, setQuery] = useState('')

  const setPref = <K extends keyof SidebarCustomization>(key: K, value: SidebarCustomization[K]) =>
    save({ ...custom, [key]: value })

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

  const togglePin = (href: string) => {
    const pinned = custom.pinned ?? []
    const next = pinned.includes(href) ? pinned.filter(h => h !== href) : [...pinned, href]
    save({ ...custom, pinned: next })
  }

  const startRename = (href: string, currentLabel: string) => {
    setRenamingHref(href)
    setRenameValue(currentLabel)
  }

  const finishRename = () => {
    if (renamingHref && renameValue.trim()) {
      const defaultLabel = allLinks.find(l => l.href === renamingHref)?.label ?? ''
      if (renameValue.trim() === defaultLabel) {
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
    save({ ...DEFAULT_CUSTOM })
  }

  // Apply order if saved
  const navGroups = defaultGroups.map(g => {
    if ((custom.order ?? []).length === 0) return g
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

  const dashGroup = navGroups.find(g => g.label === null)
  const realGroups = navGroups.filter(g => g.label !== null)

  // Behavior switches (all suppressed in edit mode, which keeps its own grouped layout)
  const slidingOn = !!custom.slidingIndicator && !editMode
  const accordion = !!custom.accordion && expanded && !editMode
  const searchOn = !!custom.search && expanded && !editMode

  // Single active link = longest href prefix match
  let activeHref = ''
  for (const l of allLinks) {
    if (pathname === l.href || pathname.startsWith(l.href + '/')) {
      if (l.href.length > activeHref.length) activeHref = l.href
    }
  }

  const pinned = custom.pinned ?? []
  const pinnedItems = pinned
    .map(h => allLinks.find(l => l.href === h))
    .filter((l): l is NonNullable<typeof l> => !!l && !isHidden(l.href))

  const q = query.trim().toLowerCase()
  const searching = searchOn && q.length > 0
  const filteredHits = searching
    ? allLinks.filter(l => !isHidden(l.href) && getLabel(l.href, l.label).toLowerCase().includes(q))
    : []

  // Accordion open group, synced to the active route
  const activeGroupLabel = realGroups.find(g => g.links.some(l => l.href === activeHref))?.label ?? null
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupLabel)
  useEffect(() => { setOpenGroup(activeGroupLabel) }, [activeGroupLabel])

  // Sliding pill measurement
  const activeRowRef = useRef<HTMLAnchorElement>(null)
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null)
  const [flyout, setFlyout] = useState<Flyout | null>(null)

  // Is the pill-eligible (group/dashboard/search) occurrence of the active row rendered?
  const isActiveVisible = (() => {
    if (!activeHref || !slidingOn) return false
    if (searching) return filteredHits.some(l => l.href === activeHref)
    if (isHidden(activeHref)) return false
    if (dashGroup?.links.some(l => l.href === activeHref)) return true
    const grp = realGroups.find(g => g.links.some(l => l.href === activeHref))
    if (!grp) return false
    return !accordion || openGroup === grp.label
  })()

  useLayoutEffect(() => {
    if (!slidingOn || !isActiveVisible) { setPill(null); return }
    const node = activeRowRef.current
    if (!node) { setPill(null); return }
    setPill({ top: node.offsetTop, height: node.offsetHeight })
  }, [slidingOn, isActiveVisible, activeHref, expanded, widthMode, openGroup, query, accordion, JSON.stringify(pinned)])

  const showPinnedSection = expanded && !editMode && pinnedItems.length > 0
  const showPinnedRail = !expanded && pinnedItems.length > 0

  const iconBtn = (on: boolean) =>
    `w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-sm transition ${
      on
        ? 'bg-indigo-600 text-white'
        : 'text-[var(--sidebar-text-secondary)] hover:text-[var(--sidebar-text)] bg-[var(--sidebar-btn)] hover:bg-[var(--sidebar-btn-hover)]'
    }`

  return (
    <div className="flex flex-col h-full">
      {/* Brand + Company */}
      <div className={`border-b border-[var(--sidebar-border)] ${expanded ? 'p-5' : 'py-5 px-2'}`}>
        <div className={`flex items-center gap-3 ${expanded ? '' : 'justify-center'}`}>
          <span className="text-2xl flex-shrink-0">{companyIcon}</span>
          {expanded && (
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold tracking-tight truncate">{companyName}</h1>
              <p className="text-[10px] text-[var(--sidebar-text-muted)] mt-0.5">Textile Management</p>
              {process.env.NEXT_PUBLIC_BUILD_ID && (
                <p className="text-[8px] text-[var(--sidebar-text-muted)] mt-0.5 opacity-50">Build: {process.env.NEXT_PUBLIC_BUILD_ID}</p>
              )}
            </div>
          )}
          {expanded && <NotificationBell />}
          {desktop && expanded && widthMode === 'full' && (
            <button onClick={() => setPref('widthMode', 'rail')} title="Collapse" className={iconBtn(false)}>«</button>
          )}
          {desktop && expanded && widthMode === 'hover' && (
            <button onClick={() => setPinOpen(!pinOpen)} title={pinOpen ? 'Unpin sidebar' : 'Keep open'} className={iconBtn(pinOpen)}>📌</button>
          )}
        </div>
        {expanded && (
          <div className="flex gap-2 mt-2">
            {role === 'admin' && (
              <Link href="/select-company" className="flex-1 flex items-center justify-center gap-1.5 text-xs text-[var(--sidebar-text-secondary)] hover:text-[var(--sidebar-text)] bg-[var(--sidebar-btn)] hover:bg-[var(--sidebar-btn-hover)] rounded-lg px-3 py-1.5 transition">
                Switch
              </Link>
            )}
            <button
              onClick={() => setEditMode(!editMode)}
              className={`flex items-center justify-center gap-1 text-xs rounded-lg px-3 py-1.5 transition ${
                editMode ? 'bg-indigo-600 text-white' : 'text-[var(--sidebar-text-secondary)] hover:text-[var(--sidebar-text)] bg-[var(--sidebar-btn)] hover:bg-[var(--sidebar-btn-hover)]'
              }`}
            >
              {editMode ? '✓ Done' : '✏️ Edit'}
            </button>
          </div>
        )}
      </div>

      {/* Expand affordance when collapsed (rail) */}
      {desktop && !expanded && widthMode === 'rail' && (
        <button onClick={() => setPref('widthMode', 'full')} title="Expand" className={`${iconBtn(false)} mx-auto mt-2`}>»</button>
      )}

      {/* Edit mode settings panel */}
      {editMode && (
        <div className="px-3 pt-2 space-y-2">
          {/* Width mode (desktop only) */}
          {desktop && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--sidebar-text-muted)] uppercase tracking-wide w-10">Width</span>
              {(['full', 'rail', 'hover'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setPref('widthMode', m)}
                  className={`flex-1 text-[10px] rounded px-1.5 py-1 capitalize transition ${
                    widthMode === m ? 'bg-indigo-600 text-white' : 'bg-[var(--sidebar-btn)] text-[var(--sidebar-text-secondary)] hover:bg-[var(--sidebar-btn-hover)]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {/* Behavior toggles */}
          {([
            { key: 'accordion', label: 'Accordion groups' },
            { key: 'search', label: 'Filter field' },
            { key: 'slidingIndicator', label: 'Sliding pill' },
          ] as const).map(t => (
            <label key={t.key} className="flex items-center justify-between cursor-pointer">
              <span className="text-[11px] text-[var(--sidebar-text-secondary)]">{t.label}</span>
              <input
                type="checkbox"
                checked={!!custom[t.key]}
                onChange={e => setPref(t.key, e.target.checked)}
                className="accent-indigo-600"
              />
            </label>
          ))}
          {pinned.length > 0 && (
            <button onClick={() => setPref('pinned', [])} className="block text-[10px] text-[var(--sidebar-text-muted)] hover:text-red-400 underline">
              Clear pinned ({pinned.length})
            </button>
          )}
          <button onClick={resetAll} className="block text-[10px] text-red-400 hover:text-red-300 underline">
            Reset to Default
          </button>
        </div>
      )}

      {/* Filter field */}
      {searchOn && (
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] opacity-60 pointer-events-none">🔍</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter menu…"
              className="w-full h-[34px] pl-8 pr-7 text-sm bg-[var(--sidebar-hover)] border border-[var(--sidebar-border)] rounded-lg text-[var(--sidebar-text)] focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)]"
                aria-label="Clear filter"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto relative space-y-1 ${expanded ? 'p-3' : 'p-2'}`}>
        {/* Sliding pill */}
        {slidingOn && pill && (
          <div
            aria-hidden
            className={`pointer-events-none absolute z-0 rounded-lg bg-[var(--sidebar-active)] transition-[top,height] duration-200 ease-out ${
              expanded ? 'left-3 right-3' : 'left-1/2 -translate-x-1/2 w-10'
            }`}
            style={{ top: pill.top, height: pill.height }}
          />
        )}

        {editMode ? (
          // ── Edit mode: grouped layout with reorder / rename / hide controls ──
          navGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'pt-3' : ''}>
              {group.label && (
                <p className="text-[10px] text-gray-500 uppercase tracking-widest px-3 mb-1.5 font-semibold">
                  {group.label}
                </p>
              )}
              {group.links.map((link, li) => {
                const hidden = isHidden(link.href)
                const label = getLabel(link.href, link.label)
                return (
                  <div key={link.href} className={`flex items-center gap-1 px-1 py-1 rounded-lg ${hidden ? 'opacity-40' : ''}`}>
                    <div className="flex flex-col">
                      <button onClick={() => moveUp(link.href, group.label)} disabled={li === 0}
                        className="text-[10px] text-gray-500 hover:text-white disabled:opacity-20 leading-none">▲</button>
                      <button onClick={() => moveDown(link.href, group.label)} disabled={li === group.links.length - 1}
                        className="text-[10px] text-gray-500 hover:text-white disabled:opacity-20 leading-none">▼</button>
                    </div>
                    <span className="text-sm leading-none">{link.icon}</span>
                    {renamingHref === link.href ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={finishRename}
                        onKeyDown={e => { if (e.key === 'Enter') finishRename() }}
                        className="flex-1 bg-[var(--sidebar-hover)] text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    ) : (
                      <span className="flex-1 text-xs text-gray-300 truncate">{label}</span>
                    )}
                    {renamingHref !== link.href && (
                      <button onClick={() => startRename(link.href, label)}
                        className="text-[10px] text-gray-500 hover:text-indigo-400" title="Rename">✏️</button>
                    )}
                    <button onClick={() => togglePin(link.href)}
                      className={`text-[11px] ${pinned.includes(link.href) ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'}`}
                      title={pinned.includes(link.href) ? 'Unpin' : 'Pin to top'}>
                      {pinned.includes(link.href) ? '⭐' : '☆'}
                    </button>
                    <button onClick={() => toggleHidden(link.href)}
                      className={`text-[10px] ${hidden ? 'text-red-400 hover:text-green-400' : 'text-gray-500 hover:text-red-400'}`}
                      title={hidden ? 'Show' : 'Hide'}>
                      {hidden ? '👁️' : '🚫'}
                    </button>
                  </div>
                )
              })}
            </div>
          ))
        ) : searching ? (
          // ── Filter results: flat list of matching links ──
          filteredHits.length === 0 ? (
            <p className="text-sm text-[var(--sidebar-text-muted)] px-3 py-2">No matches</p>
          ) : (
            filteredHits.map(l => {
              const active = l.href === activeHref
              const usePill = slidingOn && active
              return (
                <NavRow
                  key={l.href}
                  link={l}
                  label={getLabel(l.href, l.label)}
                  active={active}
                  expanded={expanded}
                  usePill={usePill}
                  slidingOn={slidingOn}
                  onNavigate={onNavigate}
                  rowRef={usePill ? activeRowRef : undefined}
                />
              )
            })
          )
        ) : (
          // ── Normal grouped layout ──
          <>
            {/* Dashboard (always visible) */}
            {dashGroup?.links.filter(l => !isHidden(l.href)).map(l => {
              const active = l.href === activeHref
              const usePill = slidingOn && active
              return (
                <NavRow
                  key={l.href}
                  link={l}
                  label={getLabel(l.href, l.label)}
                  active={active}
                  expanded={expanded}
                  usePill={usePill}
                  slidingOn={slidingOn}
                  onNavigate={onNavigate}
                  setFlyout={!expanded ? setFlyout : undefined}
                  pinControl={expanded ? { pinned: pinned.includes(l.href), toggle: () => togglePin(l.href) } : undefined}
                  pinAlwaysVisible={!desktop}
                  rowRef={usePill ? activeRowRef : undefined}
                />
              )
            })}

            {/* Pinned (expanded) */}
            {showPinnedSection && (
              <div className="pt-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest px-3 mb-1.5 font-semibold">⭐ Pinned</p>
                {pinnedItems.map(l => {
                  const active = l.href === activeHref
                  return (
                    <NavRow
                      key={'pin-' + l.href}
                      link={l}
                      label={getLabel(l.href, l.label)}
                      active={active}
                      expanded={expanded}
                      usePill={false}
                      slidingOn={slidingOn}
                      onNavigate={onNavigate}
                      pinControl={{ pinned: true, toggle: () => togglePin(l.href) }}
                    />
                  )
                })}
              </div>
            )}

            {/* Pinned (rail) */}
            {showPinnedRail && (
              <div className="mt-2 pt-2 border-t border-[var(--sidebar-border)]">
                {pinnedItems.map(l => {
                  const active = l.href === activeHref
                  return (
                    <NavRow
                      key={'pinrail-' + l.href}
                      link={l}
                      label={getLabel(l.href, l.label)}
                      active={active}
                      expanded={false}
                      usePill={false}
                      slidingOn={slidingOn}
                      onNavigate={onNavigate}
                      setFlyout={setFlyout}
                    />
                  )
                })}
              </div>
            )}

            {/* Groups */}
            {realGroups.map((group, gi) => {
              const open = !accordion || openGroup === group.label
              return (
                <div key={group.label} className="pt-3">
                  {expanded ? (
                    accordion ? (
                      <button
                        onClick={() => setOpenGroup(open ? null : group.label)}
                        className="w-full flex items-center justify-between px-3 mb-1.5"
                      >
                        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">{group.label}</span>
                        <span className={`text-[9px] text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                      </button>
                    ) : (
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest px-3 mb-1.5 font-semibold">{group.label}</p>
                    )
                  ) : (
                    gi > 0 && <div className="h-px bg-[var(--sidebar-border)] mx-2 my-2" />
                  )}
                  {open && group.links.filter(l => !isHidden(l.href)).map(l => {
                    const active = l.href === activeHref
                    const usePill = slidingOn && active
                    return (
                      <NavRow
                        key={l.href}
                        link={l}
                        label={getLabel(l.href, l.label)}
                        active={active}
                        expanded={expanded}
                        usePill={usePill}
                        slidingOn={slidingOn}
                        onNavigate={onNavigate}
                        setFlyout={!expanded ? setFlyout : undefined}
                        pinControl={expanded ? { pinned: pinned.includes(l.href), toggle: () => togglePin(l.href) } : undefined}
                        pinAlwaysVisible={!desktop}
                        rowRef={usePill ? activeRowRef : undefined}
                      />
                    )
                  })}
                </div>
              )
            })}
          </>
        )}
      </nav>

      {/* User */}
      <div className={`border-t border-[var(--sidebar-border)] ${expanded ? 'p-4' : 'py-3 px-2'}`}>
        <div className={`flex items-center gap-3 ${expanded ? 'mb-3' : 'justify-center mb-2'}`}>
          <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
            {initial}
          </div>
          {expanded && (
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{userName}</p>
              <p className="text-xs text-[var(--sidebar-text-muted)] truncate">{userEmail}</p>
            </div>
          )}
        </div>
        <div className={expanded ? 'flex gap-2 mb-2' : 'mb-2'}>
          <button
            onClick={toggle}
            className="flex-1 w-full flex items-center justify-center gap-2 text-xs text-[var(--sidebar-text-secondary)] hover:text-[var(--sidebar-text)] bg-[var(--sidebar-btn)] hover:bg-[var(--sidebar-btn-hover)] rounded-lg px-3 py-2 transition"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}{expanded && (theme === 'dark' ? ' Light Mode' : ' Dark Mode')}
          </button>
        </div>
        {expanded && <SignOutButton />}
      </div>

      {/* Rail flyout label (fixed, escapes the nav's overflow clipping) */}
      {flyout && (
        <div
          className="fixed z-[100] -translate-y-1/2 bg-slate-800 text-white text-sm font-medium px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap pointer-events-none"
          style={{ top: flyout.top, left: flyout.left }}
        >
          {flyout.label}
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ userName, userEmail, role = 'admin' }: Props) {
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState<string>('ksi')
  const pathname = usePathname()
  const { theme, toggle } = useTheme()

  const [custom, setCustom] = useState<SidebarCustomization>({ ...DEFAULT_CUSTOM })
  const [hovered, setHovered] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  // Read selected company from localStorage (ksi role is locked to ksi)
  useEffect(() => {
    if (role === 'ksi') { setCompany('ksi'); return }
    const saved = localStorage.getItem('selectedCompany')
    if (saved) setCompany(saved)
  }, [role])

  useEffect(() => {
    setCustom(loadCustomization(company))
  }, [company])

  const save = (c: SidebarCustomization) => {
    setCustom(c)
    saveCustomization(company, c)
  }

  const companyName = company === 'vi' ? 'Vinod Industries' : 'Kothari Synthetic Industries'

  const widthMode: WidthMode = custom.widthMode ?? 'full'
  const expanded = widthMode === 'full' || (widthMode === 'hover' && (hovered || pinOpen))

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
      <header className="md:hidden fixed top-0 left-0 right-0 z-30 bg-[var(--topbar-bg)] text-[var(--sidebar-text)] flex items-center gap-3 px-4 h-14 shadow-lg border-b border-[var(--sidebar-border)]">
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 rounded-lg hover:bg-[var(--sidebar-btn-hover)] transition"
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
        {role === 'admin' && <Link href="/select-company" className="text-[10px] text-[var(--sidebar-text-muted)] hover:text-white bg-[var(--sidebar-btn)] rounded px-2 py-1 shrink-0">Switch</Link>}
      </header>

      {/* ── MOBILE DRAWER OVERLAY (always full width) ── */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Drawer */}
          <aside className="relative z-50 w-72 bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] flex flex-col shadow-2xl animate-slide-in border-r border-[var(--sidebar-border)]">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--sidebar-text-muted)] hover:text-white hover:bg-[var(--sidebar-btn-hover)] transition"
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
              role={role}
              custom={custom}
              save={save}
              expanded={true}
              widthMode="full"
              desktop={false}
              pinOpen={true}
              setPinOpen={() => {}}
            />
          </aside>
        </div>
      )}

      {/* ── DESKTOP SIDEBAR ── */}
      <aside
        onMouseEnter={() => { if (widthMode === 'hover') setHovered(true) }}
        onMouseLeave={() => { if (widthMode === 'hover') setHovered(false) }}
        className={`hidden md:flex bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] flex-col flex-shrink-0 border-r border-[var(--sidebar-border)] transition-[width] duration-200 ease-out ${expanded ? 'md:w-64' : 'md:w-16'}`}
      >
        <SidebarContent
          pathname={pathname}
          onNavigate={() => {}}
          userName={userName}
          userEmail={userEmail}
          company={company}
          role={role}
          custom={custom}
          save={save}
          expanded={expanded}
          widthMode={widthMode}
          desktop={true}
          pinOpen={pinOpen}
          setPinOpen={setPinOpen}
        />
      </aside>
    </>
  )
}
