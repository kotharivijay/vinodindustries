'use client'

import Link from 'next/link'
import { useEffect, type ReactNode } from 'react'

/**
 * Shared helpers for preserving a page's view state when the user clicks a
 * lot link → /lot/[lotNo] → back. Each caller picks a unique sessionStorage
 * key (e.g. "finish-view-state") so snapshots don't collide across pages.
 *
 * Typical usage on the parent page:
 *   // 1. persist collapse/tab state whenever it changes
 *   useEffect(() => persistViewState(KEY, { tab, expanded: [...expanded] }),
 *     [tab, expanded])
 *
 *   // 2. read it back when initialising state
 *   const [tab, setTab] = useState(() => readViewState(KEY).tab ?? 'default')
 *
 *   // 3. restore scroll + highlight after a back-nav
 *   useLotBackHighlight(KEY, active)
 *
 *   // 4. render lot links through <LotLink>
 *   <LotLink lotNo={l.lotNo} storageKey={KEY}>{l.lotNo}</LotLink>
 */

export function readViewState(storageKey: string): Record<string, any> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(sessionStorage.getItem(storageKey) || '{}') } catch { return {} }
}

export function persistViewState(storageKey: string, patch: Record<string, any>) {
  if (typeof window === 'undefined') return
  try {
    const prev = readViewState(storageKey)
    sessionStorage.setItem(storageKey, JSON.stringify({ ...prev, ...patch }))
  } catch {}
}

export function saveLotClick(storageKey: string, lotNo: string, extra?: Record<string, any>) {
  if (typeof window === 'undefined') return
  persistViewState(storageKey, { ...extra, lastClickedLot: lotNo, scrollY: window.scrollY })
}

/**
 * After mounting, if `active` is true and sessionStorage has a lastClickedLot,
 * restore window scroll position and briefly ring-highlight the DOM node
 * carrying `data-lot-card="<lotNo>"`. Snapshot is cleared so a later
 * independent navigation doesn't re-trigger the highlight.
 */
export function useLotBackHighlight(storageKey: string, active: boolean = true) {
  useEffect(() => {
    if (!active) return
    const saved = readViewState(storageKey)
    const lot = saved?.lastClickedLot
    if (!lot) return
    const scrollY = typeof saved.scrollY === 'number' ? saved.scrollY : null
    const id = window.setTimeout(() => {
      if (scrollY != null) window.scrollTo(0, scrollY)
      const el = document.querySelector(`[data-lot-card="${CSS.escape(lot)}"]`) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' })
        el.classList.add('ring-2', 'ring-purple-500', 'ring-offset-1')
        window.setTimeout(() => el.classList.remove('ring-2', 'ring-purple-500', 'ring-offset-1'), 2500)
      }
      const p = readViewState(storageKey)
      delete p.scrollY; delete p.lastClickedLot
      try { sessionStorage.setItem(storageKey, JSON.stringify(p)) } catch {}
    }, 150)
    return () => window.clearTimeout(id)
  }, [storageKey, active])
}

interface LotLinkProps {
  lotNo: string
  storageKey: string
  extra?: Record<string, any>
  className?: string
  children: ReactNode
}

/**
 * Link → /lot/[lotNo] that records scrollY + lastClickedLot (+ any extras)
 * on click, so the parent page can restore its view when the user hits Back.
 * Wrap the target card with `data-lot-card={lotNo}` to enable highlighting.
 */
export function LotLink({ lotNo, storageKey, extra, className, children }: LotLinkProps) {
  return (
    <Link
      href={`/lot/${encodeURIComponent(lotNo)}`}
      onClick={() => saveLotClick(storageKey, lotNo, extra)}
      className={className}
    >
      {children}
    </Link>
  )
}
