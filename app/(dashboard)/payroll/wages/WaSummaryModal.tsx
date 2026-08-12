'use client'

// WhatsApp wages summary — builds a plain-text message (WhatsApp *bold*
// markers) and opens wa.me with it pre-filled. Two modes:
//   • contractor — one contractor's month: jobs, pool math, staff-wise
//     payments, carry. Multi-contractor staff show ONLY this contractor's
//     share. The typed number is saved back to the contractor master.
//   • standalone — the Standalone (no-contractor) section: staff-wise
//     days / wage / advance / net + a grand total. Number is not persisted.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

type WaAllocation = { contractorId: string; share: number; daysWorked: number }
type WaRow = {
  name: string
  contractors: { id: string }[]
  allocations: WaAllocation[]
  daysWorked: number | null
  calculatedWage: number
  staffAdvance: number
  netPayable: number
}
type WaBalance = {
  contractorId: string
  contractorName: string
  whatsappNo: string | null
  openingCarry: number
  jobsTotal: number
  distributed: number
  closingCarry: number
  jobs: { processName: string; quality: string | null; rate: number; quantity: number; total: number }[]
}

export type WaData =
  | { kind: 'contractor'; balance: WaBalance; rows: WaRow[] }
  | { kind: 'standalone'; rows: WaRow[] }

function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true); return () => setMounted(false) }, [])
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
const monthLabel = (mk: string) => new Date(mk + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

export function buildContractorWa(
  balance: WaBalance,
  rows: WaRow[],
  monthKey: string,
  opts: { hindi: boolean; includeJobs: boolean; includeStaff: boolean; includeAdvance: boolean; includeCarry: boolean },
): string {
  const t = opts.hindi
    ? { title: 'मज़दूरी हिसाब', jobs: 'काम (jobs)', jobsTotal: 'काम कुल', opening: 'पिछला बाकी', pool: 'कुल पूल', staff: 'स्टाफ भुगतान', advance: 'एडवांस', net: 'नेट', advBalance: 'बाकी एडवांस', shareOnly: 'सिर्फ़ इस ठेके का हिस्सा', distributed: 'बाँटा गया कुल', closing: 'अगले महीने के लिए बाकी' }
    : { title: 'Wages Summary', jobs: 'Work done (jobs)', jobsTotal: 'Jobs total', opening: 'Opening carry', pool: 'Total pool', staff: 'Staff payments', advance: 'advance', net: 'net', advBalance: 'advance balance', shareOnly: "this contractor's share only", distributed: 'Total distributed', closing: 'Carry to next month' }

  const lines: string[] = []
  lines.push(`*KOTHARI SYNTHETIC INDUSTRIES — ${t.title}*`)
  lines.push(`*${balance.contractorName} — ${monthLabel(monthKey)}*`)

  if (opts.includeJobs && balance.jobs.length > 0) {
    lines.push('')
    lines.push(`*${t.jobs}:*`)
    for (const j of balance.jobs) {
      const q = j.quality ? ` ${j.quality}` : ''
      lines.push(`• ${j.processName}${q} — ${j.quantity.toLocaleString('en-IN')} × ₹${j.rate} = ${inr(j.total)}`)
    }
    lines.push(`${t.jobsTotal}: *${inr(balance.jobsTotal)}*`)
  }

  if (opts.includeCarry) {
    lines.push(`${t.opening}: ${inr(balance.openingCarry)}`)
    lines.push(`*${t.pool}: ${inr(balance.openingCarry + balance.jobsTotal)}*`)
  }

  if (opts.includeStaff) {
    const staffRows = rows
      .map((r) => ({ r, a: r.allocations.find((x) => x.contractorId === balance.contractorId) }))
      .filter((x) => (!!x.a && x.a.share > 0) || (opts.includeAdvance && x.r.contractors.length === 1 && x.r.staffAdvance > 0))
      .sort((x, y) => (y.a?.share || 0) - (x.a?.share || 0))
    if (staffRows.length > 0) {
      lines.push('')
      lines.push(`*${t.staff}:*`)
      staffRows.forEach(({ r, a }, i) => {
        const share = a?.share || 0
        const multi = r.contractors.length > 1
        let detail: string
        if (share <= 0) {
          detail = `${t.advBalance} ${inr(r.staffAdvance)}`
        } else {
          detail = inr(share)
          if (multi) {
            detail += ` (${t.shareOnly})`
          } else if (opts.includeAdvance && r.staffAdvance > 0) {
            detail += ` · ${t.advance} ${inr(r.staffAdvance)}`
            detail += r.staffAdvance > share + 0.5
              ? ` · ${t.advBalance} ${inr(r.staffAdvance - share)}`
              : ` · ${t.net} ${inr(r.netPayable)}`
          } else {
            detail += ` · ${t.net} ${inr(share)}`
          }
        }
        lines.push(`${i + 1}) ${r.name}`)
        lines.push(`   ${detail}`)
      })
    }
    lines.push('')
    lines.push(`${t.distributed}: *${inr(balance.distributed)}*`)
  }

  if (opts.includeCarry) lines.push(`*${t.closing}: ${inr(balance.closingCarry)}*`)
  lines.push('')
  lines.push('— Kothari Synthetic Industries, Jasol')
  return lines.join('\n')
}

export function buildStandaloneWa(
  rows: WaRow[],
  monthKey: string,
  opts: { hindi: boolean; includeAdvance: boolean },
): string {
  const t = opts.hindi
    ? { title: 'मज़दूरी हिसाब — स्टैंडअलोन', staff: 'स्टाफ भुगतान', days: 'दिन', advance: 'एडवांस', net: 'नेट', total: 'कुल नेट' }
    : { title: 'Wages Summary — Standalone', staff: 'Staff payments', days: 'days', advance: 'advance', net: 'net', total: 'Total net' }

  const paid = rows.filter((r) => r.calculatedWage > 0 || (opts.includeAdvance && r.staffAdvance > 0))
    .sort((a, b) => b.calculatedWage - a.calculatedWage)
  const lines: string[] = []
  lines.push(`*KOTHARI SYNTHETIC INDUSTRIES — ${t.title}*`)
  lines.push(`*${monthLabel(monthKey)}*`)
  lines.push('')
  lines.push(`*${t.staff}:*`)
  let totalNet = 0
  paid.forEach((r, i) => {
    totalNet += r.netPayable
    let detail = `${r.daysWorked ?? 0} ${t.days} · ${inr(r.calculatedWage)}`
    if (opts.includeAdvance && r.staffAdvance > 0) detail += ` · ${t.advance} ${inr(r.staffAdvance)}`
    detail += ` · ${t.net} ${inr(r.netPayable)}`
    lines.push(`${i + 1}) ${r.name}`)
    lines.push(`   ${detail}`)
  })
  lines.push('')
  lines.push(`*${t.total}: ${inr(totalNet)}*`)
  lines.push('')
  lines.push('— Kothari Synthetic Industries, Jasol')
  return lines.join('\n')
}

export default function WaSummaryModal({ data, monthKey, onClose, onNumberSaved }: {
  data: WaData
  monthKey: string
  onClose: () => void
  onNumberSaved: () => void
}) {
  const isContractor = data.kind === 'contractor'
  const title = isContractor ? data.balance.contractorName : 'Standalone Staff'
  const [num, setNum] = useState(isContractor ? (data.balance.whatsappNo || '') : '')
  const [hindi, setHindi] = useState(true)
  const [incJobs, setIncJobs] = useState(true)
  const [incStaff, setIncStaff] = useState(true)
  const [incAdvance, setIncAdvance] = useState(true)
  const [incCarry, setIncCarry] = useState(true)
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)

  const generated = useMemo(() => (
    data.kind === 'contractor'
      ? buildContractorWa(data.balance, data.rows, monthKey, { hindi, includeJobs: incJobs, includeStaff: incStaff, includeAdvance: incAdvance, includeCarry: incCarry })
      : buildStandaloneWa(data.rows, monthKey, { hindi, includeAdvance: incAdvance })
  ), [data, monthKey, hindi, incJobs, incStaff, incAdvance, incCarry])
  const [text, setText] = useState(generated)
  useEffect(() => { if (!edited) setText(generated) }, [generated, edited])

  async function openWhatsApp() {
    const digits = num.replace(/\D/g, '')
    const full = digits ? (digits.length === 10 ? '91' + digits : digits) : ''
    setBusy(true)
    // Save the number back to the contractor master (contractor mode only).
    if (isContractor && full && full !== (data.balance.whatsappNo || '')) {
      await fetch(`/api/payroll/contractors/${data.balance.contractorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsappNo: full }),
      }).then(() => onNumberSaved()).catch(() => {})
    }
    setBusy(false)
    // wa.me works with or without a number; without one WhatsApp asks the
    // user to pick a chat.
    window.open(`https://wa.me/${full}?text=${encodeURIComponent(text)}`, '_blank')
  }

  const toggles: Array<[string, boolean, (v: boolean) => void]> = isContractor
    ? [
        ['Jobs detail', incJobs, setIncJobs],
        ['Staff payments', incStaff, setIncStaff],
        ['Advances', incAdvance, setIncAdvance],
        ['Carry / pool math', incCarry, setIncCarry],
        ['हिन्दी', hindi, setHindi],
      ]
    : [
        ['Advances', incAdvance, setIncAdvance],
        ['हिन्दी', hindi, setHindi],
      ]

  return (
    <Portal>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 w-full md:max-w-lg md:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">📱 WhatsApp Summary</h2>
              <p className="text-xs text-gray-500">{title} · {monthKey}</p>
            </div>
            <button onClick={onClose} className="text-gray-500 text-xl cursor-pointer w-9 h-9 flex items-center justify-center">×</button>
          </div>

          <div className="px-4 py-3 overflow-y-auto flex-1 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-gray-500 font-semibold">WhatsApp No:</label>
              <input value={num} onChange={(e) => setNum(e.target.value)}
                placeholder="10-digit mobile (optional)"
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm w-48 bg-white dark:bg-gray-800" />
              {isContractor && !data.balance.whatsappNo && <span className="text-[10px] text-amber-600">not on file — will be saved to contractor</span>}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {toggles.map(([label, val, set]) => (
                <button key={label}
                  onClick={() => { set(!val); setEdited(false) }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer ${
                    val ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                        : 'border-gray-300 dark:border-gray-600 text-gray-500'
                  }`}>
                  {val ? '✓ ' : ''}{label}
                </button>
              ))}
            </div>

            <textarea value={text}
              onChange={(e) => { setText(e.target.value); setEdited(true) }}
              rows={14}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono leading-relaxed bg-gray-50 dark:bg-gray-800" />
            {edited && (
              <button onClick={() => setEdited(false)} className="text-[11px] text-indigo-600 cursor-pointer">↺ Regenerate from data (discard edits)</button>
            )}
            <p className="text-[11px] text-gray-500">
              {isContractor
                ? "Multi-contractor staff show only this contractor's share. "
                : 'Standalone staff wages for the month. '}
              Opens WhatsApp with the message pre-filled — you press send there.
            </p>
          </div>

          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
            <button onClick={openWhatsApp} disabled={busy}
              className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50">
              {busy ? 'Opening…' : '📱 Open WhatsApp'}
            </button>
            <button onClick={() => { navigator.clipboard?.writeText(text) }}
              className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm cursor-pointer text-gray-700 dark:text-gray-300">
              📋 Copy
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
