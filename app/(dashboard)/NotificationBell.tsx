'use client'
import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'

interface VaultNotification {
  id: number
  documentId: number
  entityName: string
  entityType: string
  docName: string
  expiryDate: string
  daysLeft: number
  urgent: boolean
  type: 'vault'
}

interface DespatchNotification {
  id: number
  entryId: number
  challanNo: number
  lotNo: string
  message: string
  createdAt: string
  type: 'despatch'
}

interface OverflowNotification {
  type: 'overflow'
  lotNo: string
  stock: number
  grey: number
  ob: number
  overflow: { stage: string; than: number; excess: number }[]
}

type AppNotification = VaultNotification | DespatchNotification | OverflowNotification

const ENTITY_ICONS: Record<string, string> = {
  company: '\u{1F3E2}',
  person: '\u{1F464}',
  huf: '\u{1F3E0}',
  property: '\u{1F3D7}',
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const fetchNotifications = async () => {
    try {
      const [vaultRes, despatchRes, overflowRes] = await Promise.all([
        fetch('/api/vault/notifications'),
        fetch('/api/despatch/notifications'),
        fetch('/api/debug/stage-overflow'),
      ])
      const vaultData = vaultRes.ok ? await vaultRes.json() : []
      const despatchData = despatchRes.ok ? await despatchRes.json() : []
      const overflowData = overflowRes.ok ? await overflowRes.json() : []

      const all: AppNotification[] = [
        ...(Array.isArray(overflowData) ? overflowData.map((n: any) => ({ ...n, type: 'overflow' as const })) : []),
        ...(Array.isArray(vaultData) ? vaultData.map((n: any) => ({ ...n, type: 'vault' as const })) : []),
        ...(Array.isArray(despatchData) ? despatchData.map((n: any) => ({ ...n, type: 'despatch' as const })) : []),
      ]
      setNotifications(all)
    } catch {
      // silently fail
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 60000)
    return () => clearInterval(interval)
  }, [])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function dismiss(n: AppNotification) {
    if (n.type === 'overflow') return // anomalies are live-computed, can't dismiss
    if (n.type === 'vault') {
      await fetch(`/api/vault/notifications/${n.id}`, { method: 'PATCH' })
    } else {
      await fetch(`/api/despatch/notifications/${n.id}`, { method: 'PATCH' })
    }
    setNotifications(prev => prev.filter(x =>
      !(x.type !== 'overflow' && (x as any).id === (n as any).id && x.type === n.type)
    ))
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    const day = d.getDate().toString().padStart(2, '0')
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const year = d.getFullYear()
    return `${day}/${month}/${year}`
  }

  function getDaysStyle(days: number): { cls: string; label: string } {
    if (days <= 0) return { cls: 'bg-red-100 text-red-700', label: 'EXPIRED' }
    if (days <= 15) return { cls: 'bg-red-50 text-red-600', label: `\u26A0 URGENT \u2022 ${days}d` }
    if (days <= 30) return { cls: 'bg-amber-50 text-amber-700', label: `${days}d left` }
    if (days <= 60) return { cls: 'bg-yellow-50 text-yellow-700', label: `${days}d left` }
    return { cls: 'bg-green-50 text-green-700', label: `${days}d left` }
  }

  const count = notifications.length

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-1.5 rounded-lg hover:bg-gray-700 transition text-white"
        aria-label="Notifications"
      >
        <span className="text-lg leading-none">{'\u{1F514}'}</span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed md:absolute right-2 md:right-0 top-14 md:top-full mt-0 md:mt-2 w-[calc(100vw-16px)] md:w-96 max-h-[70vh] overflow-y-auto bg-white rounded-xl shadow-xl border border-gray-200 z-50">
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-800">{'\u{1F514}'} Notifications</h3>
          </div>
          {count === 0 ? (
            <div className="p-6 text-center text-gray-500 text-sm">
              No notifications
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {notifications.map(n => {
                if (n.type === 'overflow') {
                  const ov = n as OverflowNotification
                  const stages = ov.overflow.map(o => `${o.stage}=${o.than}`).join(', ')
                  const maxExcess = Math.max(...ov.overflow.map(o => o.excess))
                  return (
                    <Link
                      key={`overflow-${ov.lotNo}`}
                      href={`/lot/${encodeURIComponent(ov.lotNo)}`}
                      onClick={() => setOpen(false)}
                      className="block p-3 hover:bg-gray-50 transition"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-lg shrink-0 mt-0.5">{'\u26A0\uFE0F'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-red-700 truncate">{ov.lotNo} <span className="text-xs font-normal text-gray-400">stock {ov.stock}</span></p>
                          <p className="text-xs text-gray-600 truncate">{stages}</p>
                          <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-red-50 text-red-600">
                            +{maxExcess} excess
                          </span>
                        </div>
                      </div>
                    </Link>
                  )
                }
                if (n.type === 'vault') {
                  const vn = n as VaultNotification
                  const icon = ENTITY_ICONS[vn.entityType] || '\u{1F4C4}'
                  const style = getDaysStyle(vn.daysLeft)
                  return (
                    <div key={`vault-${vn.id}`} className="p-3 hover:bg-gray-50 transition">
                      <div className="flex items-start gap-2">
                        <span className="text-lg shrink-0 mt-0.5">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{vn.docName}</p>
                          <p className="text-xs text-gray-500 truncate">{vn.entityName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500">{formatDate(vn.expiryDate)}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${style.cls}`}>
                              {style.label}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => dismiss(n)}
                          className="text-xs text-gray-400 hover:text-gray-600 shrink-0 px-2 py-1 hover:bg-gray-100 rounded transition"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )
                } else {
                  const dn = n as DespatchNotification
                  return (
                    <div key={`despatch-${dn.id}`} className="p-3 hover:bg-gray-50 transition">
                      <div className="flex items-start gap-2">
                        <span className="text-lg shrink-0 mt-0.5">{'\u{1F69A}'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            Challan {dn.challanNo}: {dn.message}
                          </p>
                          <p className="text-xs text-gray-500 truncate">Lot {dn.lotNo}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500">{formatDate(dn.createdAt)}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-blue-50 text-blue-700">
                              Edit
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => dismiss(n)}
                          className="text-xs text-gray-400 hover:text-gray-600 shrink-0 px-2 py-1 hover:bg-gray-100 rounded transition"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )
                }
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
