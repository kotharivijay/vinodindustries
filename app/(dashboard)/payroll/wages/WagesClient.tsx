'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { currentMonthKey, monthDaysFor, daysFromShare, shareFromDays, snapDays, previousMonthKey, fmtDailyRate, type WageStrategy } from '@/lib/payrollCalc'

// Render a child in document.body via portal. Needed for our modal because
// the page's parent <div> uses animate-fade-in which applies a CSS
// transform — and `position: fixed` inside a transformed ancestor is
// anchored to that ancestor, not the viewport (per the CSS spec). The
// portal escapes that ancestor so the modal centers in the visible
// viewport regardless of scroll position.
function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true); return () => setMounted(false) }, [])
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}

type Contractor = { id: string; name: string }

type Allocation = {
  contractorId: string
  contractorName: string
  share: number
  daysWorked: number
  strategy: 'SHARE_FIRST' | 'DAYS_FIRST'
}

type Row = {
  staffId: string
  code: string
  name: string
  department: string | null
  paymentMode: string
  contractors: Contractor[]
  allocations: Allocation[]
  tallyLedgerName: string | null
  tallyLedgerFound: boolean | null
  tallyLedgerSyncedAt: string | null
  inRegister: boolean
  monthlyBaseSalary: number
  // Per-staff running carry (server-computed; same model as ContractorMonthlyBalance)
  target: number
  diff: number
  openingCarry: number
  closingCarry: number
  actualSalary: number | null
  entryId: string | null
  monthDays: number
  dailyRate: number
  daysWorked: number | null
  actualDaysWorked: number | null
  strategy: WageStrategy
  calculatedWage: number
  staffAdvance: number
  advanceSyncedAt: string | null
  netPayable: number
  postedToTally: boolean
  postedAt: string | null
  journalNo: string | null
  paymentPostedToTally: boolean
  paymentPostedAt: string | null
  paymentVoucherNo: string | null
  notes: string | null
}

type JobTemplate = { id: string; processName: string; quality: string | null; rate: number }

type ContractorBalance = {
  contractorId: string
  contractorName: string
  hiddenInWages: boolean
  openingCarry: number
  jobsTotal: number
  distributed: number
  closingCarry: number
  jobs: { id: string; processName: string; quality: string | null; rate: number; quantity: number; total: number; notes: string | null }[]
  jobTemplates: JobTemplate[]
}

type Totals = { budget: number; calculated: number; netPayable: number; advance: number; withEntry: number; posted: number }

type PreviewPayload = {
  firm: string; monthKey: string; monthDays: number; total: number
  legs: { entryId: string; staffId: string; staffName: string; staffLedger: string; amount: number }[]
  skipped: { staffId: string; staffName: string; reason: string }[]
}

const FIRMS = ['VI', 'VCF', 'VF', 'PS', 'KSI']

function fmtINR(n: number): string {
  const r = Math.round(n)
  if (r < 0) return '-₹' + Math.abs(r).toLocaleString('en-IN')
  return '₹' + r.toLocaleString('en-IN')
}

function monthsFromTo(start: string, end: string): string[] {
  const out: string[] = []
  let [y, m] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out.reverse()
}

export default function WagesClient() {
  // Default to the PREVIOUS month — wages are usually entered after a month
  // closes, not during the in-progress current month.
  const [monthKey, setMonthKey] = useState(previousMonthKey(currentMonthKey()))
  const [firm, setFirm] = useState<string>('KSI')
  const [rows, setRows] = useState<Row[]>([])
  const [balances, setBalances] = useState<Record<string, ContractorBalance>>({})
  const [totals, setTotals] = useState<Totals>({ budget: 0, calculated: 0, netPayable: 0, advance: 0, withEntry: 0, posted: 0 })
  const [loading, setLoading] = useState(false)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [calcAllBusy, setCalcAllBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncSummary, setSyncSummary] = useState<{ updated: number; notFound: number; skippedLocked?: number; missingExamples: { staffName: string; tallyLedger: string }[] } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // New state variables for Payment Vouchers
  const [bankDetailsMap, setBankDetailsMap] = useState<Record<string, { accountNumber: string; ifsc: string; bankName: string; branch: string }>>({})
  const [paymentPreview, setPaymentPreview] = useState<PreviewPayload | null>(null)
  const [paymentPreviewBusy, setPaymentPreviewBusy] = useState(false)
  const [paymentPostBusy, setPaymentPostBusy] = useState(false)
  const [paymentPostResult, setPaymentPostResult] = useState<{ ok: boolean; paymentVoucherNo?: string; posted?: number; total?: number; error?: string } | null>(null)
  const [bankLedger, setBankLedger] = useState('HDFC BANK')

  const toggleRowSelection = useCallback((entryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId); else next.add(entryId)
      return next
    })
  }, [])

  const toggleGroupSelection = useCallback((groupRows: Row[]) => {
    const selectableRows = groupRows.filter((r) =>
      r.entryId && (
        (!r.postedToTally && r.calculatedWage > 0) ||
        (!r.paymentPostedToTally && r.netPayable > 0)
      )
    )
    const selectableIds = selectableRows.map((r) => r.entryId as string)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = selectableIds.every((id) => next.has(id))
      if (allSelected) {
        selectableIds.forEach((id) => next.delete(id))
      } else {
        selectableIds.forEach((id) => next.add(id))
      }
      return next
    })
  }, [])

  const [postBusy, setPostBusy] = useState(false)
  const [postResult, setPostResult] = useState<{ ok: boolean; posted?: number; failed?: number; total?: number; error?: string; failedDetails?: { staffLedger: string; error?: string }[] } | null>(null)
  const [wagesLedger, setWagesLedger] = useState('WAGES AND SALARY')
  const [voucherDate, setVoucherDate] = useState<string>('')
  const [narration, setNarration] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // rowsRef mirrors the latest rows state so persistRow (running inside a
  // setTimeout closure) reads CURRENT values, not whatever the render was
  // when queueSave fired. Without this, a fast type+tab sequence would send
  // the pre-edit share to the server and the load() reload would clobber
  // the user's typed value.
  const rowsRef = useRef<Row[]>(rows)
  useEffect(() => { rowsRef.current = rows }, [rows])
  // Track the fixed-position header's actual rendered height so the
  // content spacer below matches it (header height varies with the
  // optional sync banner + hidden-contractor note + KPI wrap on mobile).
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerH, setHeaderH] = useState(0)
  // Mobile-only header collapse — phone users complained the fixed
  // header (toolbar + KPIs + banners) was eating ~half the screen.
  // When collapsed only the toolbar row renders; KPIs + sync banner +
  // hidden-note are hidden. Toggle via a small chevron at the bottom-
  // right edge of the fixed header.
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setHeaderH(el.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const monthDays = monthDaysFor(monthKey)

  // Every entry that's still actionable (journal OR payment pending).
  // Drives the global Select All / Deselect All toolbar checkbox.
  const allPendingIds = useMemo(() =>
    rows
      .filter((r) => r.entryId && ((!r.postedToTally && r.calculatedWage > 0) || (!r.paymentPostedToTally && r.netPayable > 0)))
      .map((r) => r.entryId as string)
  , [rows])

  const monthOptions = useMemo(() => {
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 18, 1))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    return monthsFromTo(currentMonthKey(start), currentMonthKey(end))
  }, [])

  const load = useCallback(async (mk: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/payroll/wages?month=${mk}&t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      })
      if (!res.ok) throw new Error('Load failed')
      const data = await res.json()
      setRows(data.rows)
      setBalances(data.contractorBalances || {})
      setTotals(data.totals)

      // No auto-select on load — user explicitly ticks the toolbar
      // "Select all" checkbox or per-row / per-section boxes.
      setSelectedIds(new Set())
    } catch (e) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load(monthKey) }, [monthKey, load])

  // Group rows: Standalone (no contractors) then one section per contractor.
  // A staff tagged to N contractors appears in N sections, each carrying the
  // staff's allocation FOR THAT contractor (or a fresh empty one).
  const groups = useMemo(() => {
    const standaloneRows = rows.filter((r) => r.contractors.length === 0)
    const contractorBuckets = new Map<string, { id: string; name: string; rows: Row[] }>()
    for (const r of rows) {
      for (const c of r.contractors) {
        const b = contractorBuckets.get(c.id) || { id: c.id, name: c.name, rows: [] }
        b.rows.push(r); contractorBuckets.set(c.id, b)
      }
    }
    // Also include contractors that have process jobs but no tagged staff yet.
    for (const [cid, b] of Object.entries(balances)) {
      if (!contractorBuckets.has(cid)) contractorBuckets.set(cid, { id: cid, name: b.contractorName, rows: [] })
    }
    const sections: { kind: 'standalone' | 'contractor'; id: string; name: string; rows: Row[] }[] = []
    if (standaloneRows.length) sections.push({ kind: 'standalone', id: '__none__', name: 'Standalone (no contractor)', rows: standaloneRows })
    const contractorSorted = Array.from(contractorBuckets.values()).sort((a, b) => a.name.localeCompare(b.name))
    for (const c of contractorSorted) sections.push({ kind: 'contractor', id: c.id, name: c.name, rows: c.rows })
    return sections
  }, [rows, balances])

  function toggleGroup(id: string) {
    setCollapsedGroups((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Apply a local optimistic change to a staff row, then debounce a save.
  function updateAllocation(staffId: string, contractorId: string, patch: Partial<Allocation>) {
    setRows((prev) => prev.map((r) => {
      if (r.staffId !== staffId) return r
      // Always derive from the live month's days, not the row's stored
      // monthDays — guards against stale entry.monthDays from older months.
      const liveRate = monthDays > 0 ? r.monthlyBaseSalary / monthDays : 0
      const existing = r.allocations.find((a) => a.contractorId === contractorId)
      const contractorName = r.contractors.find((c) => c.id === contractorId)?.name || existing?.contractorName || ''
      const baseAlloc: Allocation = existing
        ? { ...existing, ...patch }
        : { contractorId, contractorName, share: 0, daysWorked: 0, strategy: 'SHARE_FIRST', ...patch }
      if (baseAlloc.strategy === 'SHARE_FIRST') {
        baseAlloc.daysWorked = daysFromShare(baseAlloc.share, liveRate, monthDays)
      } else {
        baseAlloc.share = shareFromDays(baseAlloc.daysWorked, liveRate, monthDays)
      }
      const newAllocs = existing
        ? r.allocations.map((a) => a.contractorId === contractorId ? baseAlloc : a)
        : [...r.allocations, baseAlloc]
      const totalShare = newAllocs.reduce((s, a) => s + a.share, 0)
      const totalDays = newAllocs.reduce((s, a) => s + a.daysWorked, 0)
      return {
        ...r,
        monthDays,
        dailyRate: liveRate,
        allocations: newAllocs,
        daysWorked: totalDays,
        calculatedWage: totalShare,
        netPayable: Math.max(0, totalShare - r.staffAdvance),
      }
    }))
    queueSave(staffId, { allocations: true, contractorId })
  }

  // Standalone (no contractor) staff — edit daysWorked and/or advance.
  // Recomputes wage from days × liveRate.
  //
  // CONTRACTOR-linked staff also funnel their Advance edits here. For them
  // we MUST NOT recompute wage from r.daysWorked — that field is the sum of
  // allocation days and recomputing it via liveRate × days double-counts or
  // (when daysWorked is stale from a prior sync) inflates the wage. Instead
  // keep r.calculatedWage from the allocation sum and only update advance.
  function updateStandalone(staffId: string, patch: { daysWorked?: number; actualDaysWorked?: number; staffAdvance?: number }) {
    setRows((prev) => prev.map((r) => {
      if (r.staffId !== staffId) return r
      const isContractorStaff = r.contractors.length > 0
      if (isContractorStaff) {
        // Advance-only update path (contractor staff never use the days
        // stepper at the staff level — days live per-allocation).
        const advance = patch.staffAdvance ?? r.staffAdvance
        return {
          ...r,
          staffAdvance: advance,
          netPayable: Math.max(0, r.calculatedWage - advance),
        }
      }
      // True standalone path
      const liveRate = monthDays > 0 ? r.monthlyBaseSalary / monthDays : 0
      const advance = patch.staffAdvance ?? r.staffAdvance

      if (r.actualSalary != null && r.actualSalary > 0) {
        // Register days = primary editable input → wage = dailyRate × registerDays.
        // Actual days = secondary editable input → target salary (informational only).
        // No auto-derivation between them.
        const regDays = snapDays(patch.daysWorked ?? r.daysWorked ?? 0, monthDays)
        const actDays = patch.actualDaysWorked !== undefined
          ? snapDays(patch.actualDaysWorked, monthDays)
          : (r.actualDaysWorked ?? monthDays)
        const calculatedWage = liveRate * regDays
        return {
          ...r,
          monthDays,
          dailyRate: liveRate,
          daysWorked: regDays,
          actualDaysWorked: actDays,
          calculatedWage,
          staffAdvance: advance,
          netPayable: Math.max(0, calculatedWage - advance),
        }
      }

      // True standalone path: wage is derived from days × liveRate.
      const days = snapDays(patch.daysWorked ?? r.daysWorked ?? 0, monthDays)
      const calculatedWage = liveRate * days
      return {
        ...r,
        monthDays,
        dailyRate: liveRate,
        daysWorked: days,
        calculatedWage,
        staffAdvance: advance,
        netPayable: Math.max(0, calculatedWage - advance),
      }
    }))
    queueSave(staffId, { allocations: false })
  }

  function queueSave(staffId: string, _info: { allocations: boolean; contractorId?: string }) {
    const existing = saveTimers.current.get(staffId)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => persistRow(staffId), 350)
    saveTimers.current.set(staffId, t)
  }

  async function persistRow(staffId: string) {
    // Use the live ref — `rows` captured at render time may be stale by the
    // time this fires (setTimeout closure problem).
    const row = rowsRef.current.find((r) => r.staffId === staffId)
    if (!row) return
    setSavingIds((s) => new Set(s).add(staffId))
    try {
      const body = row.contractors.length > 0
        ? {
            allocations: row.allocations.map((a) => ({
              contractorId: a.contractorId,
              share: a.share,
              days: a.daysWorked,
              strategy: a.strategy,
            })),
            staffAdvance: row.staffAdvance,
          }
        : {
            daysWorked: row.daysWorked ?? 0,
            actualDaysWorked: row.actualDaysWorked ?? undefined,
            strategy: 'DAYS_FIRST' as WageStrategy,
            staffAdvance: row.staffAdvance,
          }
      const res = await fetch(`/api/payroll/wages/${staffId}?month=${monthKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      // Reload to pick up server-recomputed balances for the contractors involved.
      await load(monthKey)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSavingIds((s) => { const n = new Set(s); n.delete(staffId); return n })
    }
  }

  async function calculateAll() {
    setCalcAllBusy(true); setError(null)
    try {
      const res = await fetch('/api/payroll/wages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: monthKey }),
      })
      if (!res.ok) throw new Error('Bulk create failed')
      await load(monthKey)
    } catch (e) {
      setError((e as Error).message)
    } finally { setCalcAllBusy(false) }
  }

  async function syncAdvances() {
    if (!confirm(`Pull staff advance closing balances from Tally (${firm}) for ${monthKey}? This may take ~30s.`)) return
    setSyncBusy(true); setError(null); setSyncSummary(null)
    try {
      const res = await fetch('/api/payroll/wages/sync-advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: monthKey, firm }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setSyncSummary({ updated: data.updated, notFound: data.notFound, skippedLocked: data.skippedLocked, missingExamples: data.missingExamples || [] })
      await load(monthKey)
    } catch (e) {
      setError((e as Error).message)
    } finally { setSyncBusy(false) }
  }

  async function openPreview() {
    setPreviewBusy(true); setError(null); setPostResult(null)
    try {
      const idsParam = selectedIds.size > 0 ? `&entryIds=${Array.from(selectedIds).join(',')}` : ''
      const res = await fetch(`/api/payroll/wages/post-journal?month=${monthKey}&firm=${firm}${idsParam}&t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setPreview(data)
      if (!narration) setNarration(`Wages and salary — ${monthKey}`)
      // Journal voucher defaults to 7th of NEXT month (the firm's wage
      // cut-off date). Always overwrite — otherwise a date left over
      // from the Payment preview (today) would silently override.
      {
        const [y, m] = monthKey.split('-').map(Number)
        const nextY = m === 12 ? y + 1 : y
        const nextM = m === 12 ? 1 : m + 1
        setVoucherDate(`${nextY}-${String(nextM).padStart(2, '0')}-07`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally { setPreviewBusy(false) }
  }

  async function postJournal() {
    if (!preview) return
    if (!confirm(`Post a Journal voucher to ${firm} Tally?\n  ${preview.legs.length} staff, ₹${Math.round(preview.total).toLocaleString('en-IN')} total.\n\nThis cannot be undone from the app.`)) return
    setPostBusy(true); setPostResult(null); setError(null)
    try {
      const res = await fetch('/api/payroll/wages/post-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: monthKey,
          firm,
          voucherDate,
          wagesLedger,
          narration,
          entryIds: Array.from(selectedIds),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPostResult({ ok: false, error: data.error || 'Post failed' })
        return
      }
      setPostResult({ ok: data.ok, posted: data.posted, failed: data.failed, total: data.total, failedDetails: data.failedDetails })
      await load(monthKey)
      setSelectedIds(new Set())
    } catch (e) {
      setPostResult({ ok: false, error: (e as Error).message })
    } finally { setPostBusy(false) }
  }

  async function openPaymentPreview() {
    setPaymentPreviewBusy(true); setError(null); setPaymentPostResult(null)
    try {
      const idsParam = selectedIds.size > 0 ? `&entryIds=${Array.from(selectedIds).join(',')}` : ''
      const [prevRes, bankRes] = await Promise.all([
        fetch(`/api/payroll/wages/post-payment?month=${monthKey}&firm=${firm}${idsParam}&t=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' }
        }),
        fetch(`/api/payroll/wages/bank-details?firm=${firm}&t=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' }
        })
      ])
      
      const prevData = await prevRes.json()
      if (!prevRes.ok) throw new Error(prevData.error || 'Payment preview failed')
      
      const bankData = await bankRes.json()
      if (!bankRes.ok) throw new Error(bankData.error || 'Failed to fetch Tally bank details')
      
      setPaymentPreview(prevData)
      setBankDetailsMap(bankData)

      if (!narration) setNarration(`Wages payment — ${monthKey}`)
      // Payment voucher defaults to TODAY's date (= when the bank
      // transfer actually happens). Always overwrite — if the user had
      // a date left over from the Journal preview (which uses 7th of
      // next month), they almost certainly want today for the payment.
      {
        const t = new Date()
        setVoucherDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally { setPaymentPreviewBusy(false) }
  }

  async function postPayments() {
    if (!paymentPreview) return
    if (!confirm(`Post Payment vouchers to ${firm} Tally?\n  ${paymentPreview.legs.length} staff, ₹${Math.round(paymentPreview.total).toLocaleString('en-IN')} total.\n\nThis cannot be undone from the app.`)) return
    setPaymentPostBusy(true); setPaymentPostResult(null); setError(null)
    try {
      const res = await fetch('/api/payroll/wages/post-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: monthKey,
          firm,
          voucherDate,
          bankLedger,
          narration,
          entryIds: Array.from(selectedIds),
          bankDetails: bankDetailsMap,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPaymentPostResult({ ok: false, error: data.error || 'Post failed' })
        return
      }
      setPaymentPostResult({ ok: true, paymentVoucherNo: data.paymentVoucherNo, posted: data.posted, total: data.total })
      await load(monthKey)
      setSelectedIds(new Set())
    } catch (e) {
      setPaymentPostResult({ ok: false, error: (e as Error).message })
    } finally { setPaymentPostBusy(false) }
  }

  // Toggle the persisted hiddenInWages flag for a contractor.
  // Server stores it on the Contractor row so the choice survives reloads.
  const [showHidden, setShowHidden] = useState(false)
  async function setContractorHidden(contractorId: string, hidden: boolean) {
    // Optimistic flip
    setBalances((b) => ({ ...b, [contractorId]: { ...b[contractorId], hiddenInWages: hidden } }))
    const res = await fetch(`/api/payroll/contractors/${contractorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenInWages: hidden }),
    })
    if (!res.ok) {
      // Revert on failure
      setBalances((b) => ({ ...b, [contractorId]: { ...b[contractorId], hiddenInWages: !hidden } }))
      setError('Hide toggle failed')
    }
  }

  async function addJob(contractorId: string, j: { processName: string; quality?: string; rate: number; quantity: number }) {
    const res = await fetch('/api/payroll/contractor-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractorId, monthKey, ...j }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Add job failed'); return }
    await load(monthKey)
  }

  async function deleteJob(jobId: string) {
    if (!confirm('Delete this process job?')) return
    const res = await fetch(`/api/payroll/contractor-jobs/${jobId}`, { method: 'DELETE' })
    if (!res.ok) { setError('Delete failed'); return }
    await load(monthKey)
  }

  async function updateJobQty(jobId: string, quantity: number) {
    const res = await fetch(`/api/payroll/contractor-jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    })
    if (!res.ok) { setError('Update failed'); return }
    await load(monthKey)
  }

  // Clear posted flags so the user can re-push to Tally — typically after
  // they manually deleted the voucher inside Tally.
  async function resetPosted(entryId: string, kind: 'journal' | 'payment' | 'both', label: string) {
    const what = kind === 'journal' ? 'Journal posted status' : kind === 'payment' ? 'Payment posted status' : 'BOTH Journal AND Payment posted statuses'
    if (!confirm(`Reset ${what} for ${label}?\n\nThis only clears the flag in THIS APP. If the voucher still exists in Tally and you re-post, you will create a DUPLICATE in Tally.\n\nMake sure you have deleted it in Tally first.`)) return
    const res = await fetch('/api/payroll/wages/reset-posted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryIds: [entryId], kind }),
    })
    if (!res.ok) { setError('Reset failed'); return }
    await load(monthKey)
  }

  // Footer counters track unique staff only (staff appearing in N contractor
  // sections still counts as 1 person).
  const uniqueStaffCount = rows.length

  // Tally advance closing balance is fetched AS OF TODAY — meaningful only
  // for current or previous month wages (older months would post a journal
  // that's no longer relevant to today's advance position). Block the
  // button outside that window.
  const syncAllowed = useMemo(() => {
    const cur = currentMonthKey()
    const prev = previousMonthKey(cur)
    return monthKey === cur || monthKey === prev
  }, [monthKey])

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Fixed header — anchored to viewport so it stays visible no matter
          how far the page is scrolled. `position: sticky` failed because
          <main> has overflow-y-auto but no fixed height — the CSS spec
          still treats it as the scroll container even though body actually
          scrolls, so the sticky pin-point scrolls away with main.
          headerRef + ResizeObserver track the header's height so the
          spacer below is exactly the right size. */}
      <div ref={headerRef}
        className="fixed top-0 left-0 right-0 md:left-64 z-30 px-4 md:px-8 pt-3 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-700">
      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between flex-wrap">
        <div className="flex items-center justify-between w-full md:w-auto gap-2">
          <h1 className="text-lg md:text-2xl font-bold">Payroll · Wages</h1>
          <div className="flex gap-2">
            <select value={firm} onChange={(e) => setFirm(e.target.value)}
              className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 font-semibold" title="Tally firm">
              {FIRMS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={monthKey} onChange={(e) => setMonthKey(e.target.value)}
              className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 font-semibold">
              {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full md:w-auto">
          <button onClick={calculateAll} disabled={calcAllBusy || loading}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer w-full sm:w-auto text-center">
            {calcAllBusy ? 'Working…' : '⚡ Calc All'}
          </button>
          <button onClick={syncAdvances} disabled={syncBusy || loading || !syncAllowed}
            title={syncAllowed ? 'Pull staff advance closing balance from Tally as of today' : 'Sync Advances is only allowed for the current month or the previous month — Tally always returns the live (today\'s) balance, which doesn\'t correspond to older months.'}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer w-full sm:w-auto text-center">
            {syncBusy ? 'Syncing…' : '🔄 Sync Advances'}
          </button>
          <button onClick={openPreview} disabled={previewBusy || loading || selectedIds.size === 0}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white cursor-pointer w-full sm:w-auto text-center">
            {previewBusy ? 'Loading…' : `📋 Preview Journal (${selectedIds.size})`}
          </button>
          <button onClick={openPaymentPreview} disabled={paymentPreviewBusy || loading || selectedIds.size === 0}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white cursor-pointer w-full sm:w-auto text-center">
            {paymentPreviewBusy ? 'Loading…' : `💸 Preview Pay (${selectedIds.size})`}
          </button>
        </div>
        <div className="w-full flex justify-between items-center bg-gray-50 dark:bg-gray-800/40 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
          <label className="text-xs flex items-center gap-1.5 cursor-pointer select-none"
            title="Select / deselect all pending wage entries across every section">
            <input type="checkbox"
              ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < allPendingIds.length }}
              checked={allPendingIds.length > 0 && selectedIds.size === allPendingIds.length}
              onChange={() => {
                if (selectedIds.size === allPendingIds.length) setSelectedIds(new Set())
                else setSelectedIds(new Set(allPendingIds))
              }} />
            Select all ({selectedIds.size}/{allPendingIds.length})
          </label>
          <span className="text-xs font-medium text-gray-500">{monthKey} ({monthDays} days)</span>
        </div>
      </div>

      <div className={headerCollapsed ? 'hidden md:block' : ''}>
      {syncSummary && (
        <div className="card p-3 mb-3 border-l-4 border-amber-500 bg-amber-50/30 dark:bg-amber-900/10 text-xs">
          <p>
            Advance sync: <strong className="text-emerald-700">{syncSummary.updated} updated</strong>
            {syncSummary.skippedLocked ? <> · <strong className="text-gray-700">{syncSummary.skippedLocked} skipped (already posted to Tally)</strong></> : null}
            {syncSummary.notFound > 0 && <> · <strong className="text-red-700">{syncSummary.notFound} ledger names not found in Tally</strong></>}
          </p>
          {syncSummary.notFound > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-red-700">Show missing</summary>
              <ul className="mt-1 pl-4 list-disc">
                {syncSummary.missingExamples.map((m, i) => (
                  <li key={i}>{m.staffName} → <span className="font-mono">{m.tallyLedger}</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Budget (sum of monthly salaries)</p><p className="text-lg font-bold">{fmtINR(totals.budget)}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Calculated (distributed)</p><p className="text-lg font-bold">{fmtINR(totals.calculated)}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Net payable</p><p className="text-lg font-bold">{fmtINR(totals.netPayable)}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Posted to Tally</p><p className="text-lg font-bold">{totals.posted} / {uniqueStaffCount}</p></div>
      </div>

      {error && <div className="card p-3 mb-3 border-l-4 border-red-500 bg-red-50/30 text-xs text-red-700">{error}</div>}
      {loading && <div className="text-sm text-gray-500 mb-3">Loading…</div>}

      {!loading && rows.length === 0 && (
        <div className="card p-8 text-center text-gray-400">No active staff. Add them in <a href="/payroll/staff" className="text-indigo-600 hover:underline">Staff Register</a>.</div>
      )}

      {(() => {
        const hiddenCount = groups.filter((g) => g.kind === 'contractor' && balances[g.id]?.hiddenInWages).length
        if (hiddenCount === 0) return null
        return (
          <div className="text-xs mb-3 flex items-center gap-2 text-gray-600 dark:text-gray-400">
            <span>{hiddenCount} contractor section{hiddenCount === 1 ? '' : 's'} hidden.</span>
            <button onClick={() => setShowHidden((v) => !v)}
              className="font-semibold underline hover:text-indigo-700">
              {showHidden ? 'Hide them' : 'Show hidden'}
            </button>
          </div>
        )
      })()}
      </div>
      {/* End of the headerCollapsed-aware wrapper. */}
      </div>

      {/* Mobile-only chevron tab — sticks out below the fixed header,
          clicking collapses/expands the heavy parts (KPIs, sync banner,
          hidden-note). Always reflects the current state. Hidden on
          md+ since desktop has plenty of room. */}
      <button onClick={() => setHeaderCollapsed((v) => !v)}
        className="md:hidden fixed right-3 z-40 px-2 py-0.5 rounded-b-lg bg-white/95 dark:bg-gray-900/95 border border-t-0 border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 shadow"
        style={{ top: headerH }}
        aria-label={headerCollapsed ? 'Expand header' : 'Collapse header'}>
        {headerCollapsed ? '▾ Show stats' : '▴ Hide stats'}
      </button>

      {/* Spacer matching the fixed header's height so the content below
          starts just under it instead of being hidden behind it. */}
      <div style={{ height: headerH }} aria-hidden="true" />

      {groups.filter((g) => {
        // Filter hidden contractor sections out unless "Show hidden" is on.
        if (g.kind !== 'contractor') return true
        const b = balances[g.id]
        return showHidden || !b?.hiddenInWages
      }).map((g) => {
        const isOpen = !collapsedGroups.has(g.id)
        const balance = g.kind === 'contractor' ? balances[g.id] : undefined
        return (
          <div key={g.id} className={`card overflow-hidden mb-4 ${balance?.hiddenInWages ? 'opacity-60 border-2 border-dashed border-gray-300 dark:border-gray-700' : ''}`}>
            <SectionHeader
              kind={g.kind}
              name={g.name}
              isOpen={isOpen}
              onToggle={() => toggleGroup(g.id)}
              rowCount={g.rows.length}
              balance={balance}
              onToggleHide={balance ? () => setContractorHidden(g.id, !balance.hiddenInWages) : undefined}
            />
            {isOpen && g.kind === 'contractor' && balance && (
              <ProcessJobsEditor
                balance={balance}
                onAdd={(j) => addJob(g.id, j)}
                onDelete={(id) => deleteJob(id)}
                onUpdateQty={(id, qty) => updateJobQty(id, qty)}
              />
            )}
            {isOpen && (
              <>
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800/50">
                      <tr>
                        <th className="px-2 py-2 text-left w-8">
                          <input
                            type="checkbox"
                            checked={
                              g.rows.filter((r) => r.entryId && ((!r.postedToTally && r.calculatedWage > 0) || (!r.paymentPostedToTally && r.netPayable > 0))).length > 0 &&
                              g.rows.filter((r) => r.entryId && ((!r.postedToTally && r.calculatedWage > 0) || (!r.paymentPostedToTally && r.netPayable > 0))).every((r) => selectedIds.has(r.entryId as string))
                            }
                            onChange={() => toggleGroupSelection(g.rows)}
                            disabled={g.rows.filter((r) => r.entryId && ((!r.postedToTally && r.calculatedWage > 0) || (!r.paymentPostedToTally && r.netPayable > 0))).length === 0}
                            className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </th>
                        <th className="px-2 py-2 text-left">Code</th>
                        <th className="px-2 py-2 text-left">Name</th>
                        <th className="px-2 py-2 text-right">Salary</th>
                        <th className="px-2 py-2 text-right">Daily Rate</th>
                        <th className="px-2 py-2 text-center">Days</th>
                        <th className="px-2 py-2 text-right">Share</th>
                        <th className="px-2 py-2 text-center">Mode</th>
                        <th className="px-2 py-2 text-right">Advance</th>
                        <th className="px-2 py-2 text-right">Net Payable</th>
                        <th className="px-2 py-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.length === 0 && (
                        <tr><td colSpan={11} className="px-4 py-6 text-center text-gray-400 text-xs">No staff tagged to this contractor yet.</td></tr>
                      )}
                      {g.rows.map((r) => g.kind === 'standalone'
                        ? <StandaloneRow
                            key={r.staffId}
                            row={r}
                            liveMonthDays={monthDays}
                            onChange={(p) => updateStandalone(r.staffId, p)}
                            saving={savingIds.has(r.staffId)}
                            isSelected={!!r.entryId && selectedIds.has(r.entryId)}
                            onToggleSelect={() => r.entryId && toggleRowSelection(r.entryId)}
                            onResetPosted={(kind) => r.entryId && resetPosted(r.entryId, kind, `${r.code} ${r.name}`)}
                          />
                        : <AllocationRow
                            key={`${g.id}|${r.staffId}`}
                            row={r}
                            contractorId={g.id}
                            liveMonthDays={monthDays}
                            onChange={(p) => updateAllocation(r.staffId, g.id, p)}
                            onChangeAdvance={(v) => updateStandalone(r.staffId, { staffAdvance: v })}
                            saving={savingIds.has(r.staffId)}
                            isSelected={!!r.entryId && selectedIds.has(r.entryId)}
                            onToggleSelect={() => r.entryId && toggleRowSelection(r.entryId)}
                            onResetPosted={(kind) => r.entryId && resetPosted(r.entryId, kind, `${r.code} ${r.name}`)}
                          />
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards View */}
                <div className="block md:hidden space-y-3 bg-gray-50/50 dark:bg-gray-900/10 p-3 border-t border-gray-200 dark:border-gray-700">
                  {g.rows.length === 0 && (
                    <div className="py-6 text-center text-gray-400 text-xs">No staff tagged to this contractor yet.</div>
                  )}
                  {g.rows.map((r) => g.kind === 'standalone'
                    ? <MobileStandaloneRow
                        key={r.staffId}
                        row={r}
                        liveMonthDays={monthDays}
                        onChange={(p) => updateStandalone(r.staffId, p)}
                        saving={savingIds.has(r.staffId)}
                        isSelected={!!r.entryId && selectedIds.has(r.entryId)}
                        onToggleSelect={() => r.entryId && toggleRowSelection(r.entryId)}
                        onResetPosted={(kind) => r.entryId && resetPosted(r.entryId, kind, `${r.code} ${r.name}`)}
                      />
                    : <MobileAllocationRow
                        key={`${g.id}|${r.staffId}`}
                        row={r}
                        contractorId={g.id}
                        liveMonthDays={monthDays}
                        onChange={(p) => updateAllocation(r.staffId, g.id, p)}
                        onChangeAdvance={(v) => updateStandalone(r.staffId, { staffAdvance: v })}
                        saving={savingIds.has(r.staffId)}
                        isSelected={!!r.entryId && selectedIds.has(r.entryId)}
                        onToggleSelect={() => r.entryId && toggleRowSelection(r.entryId)}
                        onResetPosted={(kind) => r.entryId && resetPosted(r.entryId, kind, `${r.code} ${r.name}`)}
                      />
                  )}
                </div>
              </>
            )}
            {isOpen && balance && g.kind === 'contractor' && (
              <ContractorBalanceFooter balance={balance} />
            )}
            {isOpen && g.kind === 'standalone' && (
              <StandaloneCarryFooter rows={g.rows} />
            )}
          </div>
        )
      })}

      <p className="text-xs text-gray-500 mt-4">
        Daily rate = round(salary ÷ {monthDays}). For contractor-tagged staff, enter Share (₹) or Days under each contractor — the other auto-derives. Standalone staff: enter days at their daily rate. Carry surplus/shortage flows to the next month&apos;s opening pool automatically.
      </p>

      {preview && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={() => !postBusy && setPreview(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-base font-semibold">Journal Preview — {firm} · {preview.monthKey}</h2>
              <button onClick={() => setPreview(null)} disabled={postBusy} className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-xl leading-none">×</button>
            </div>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Voucher Date</label>
                <input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Wages Expense Ledger (Dr)</label>
                <input value={wagesLedger} onChange={(e) => setWagesLedger(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800 font-mono text-xs" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Narration</label>
                <input value={narration} onChange={(e) => setNarration(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800" />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left">Dr / Cr</th>
                    <th className="px-3 py-2 text-left">Ledger</th>
                    <th className="px-3 py-2 text-left">Staff</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-indigo-50 dark:bg-indigo-900/20 font-semibold">
                    <td className="px-3 py-2">Dr</td>
                    <td className="px-3 py-2 font-mono">{wagesLedger}</td>
                    <td className="px-3 py-2 text-gray-500">(consolidated)</td>
                    <td className="px-3 py-2 text-right">{fmtINR(preview.total)}</td>
                  </tr>
                  {preview.legs.map((l) => (
                    <tr key={l.entryId} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-1.5 text-gray-500">Cr</td>
                      <td className="px-3 py-1.5 font-mono">{l.staffLedger}</td>
                      <td className="px-3 py-1.5">{l.staffName}</td>
                      <td className="px-3 py-1.5 text-right">{fmtINR(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 dark:bg-gray-800 font-bold border-t-2 border-gray-300 dark:border-gray-600">
                    <td className="px-3 py-2" colSpan={3}>TOTAL</td>
                    <td className="px-3 py-2 text-right">{fmtINR(preview.total)}</td>
                  </tr>
                </tfoot>
              </table>
              {preview.skipped.length > 0 && (
                <div className="p-3 bg-amber-50/40 dark:bg-amber-900/10 border-t border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">{preview.skipped.length} skipped (no Tally ledger set):</p>
                  <ul className="text-xs text-gray-600 dark:text-gray-400 list-disc pl-5">
                    {preview.skipped.slice(0, 10).map((s, i) => <li key={i}>{s.staffName}</li>)}
                    {preview.skipped.length > 10 && <li>… +{preview.skipped.length - 10} more</li>}
                  </ul>
                </div>
              )}
            </div>
            {postResult && (
              <div className={`px-4 py-2 text-sm ${postResult.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : (postResult.posted ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300' : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300')}`}>
                {postResult.posted !== undefined && (
                  <div>✓ Posted {postResult.posted} journal vouchers (one per staff), total {fmtINR(postResult.total || 0)}.</div>
                )}
                {postResult.failed ? (
                  <div className="mt-1">⚠ {postResult.failed} failed:
                    <ul className="text-xs pl-4 list-disc">
                      {postResult.failedDetails?.slice(0, 10).map((f, i) => <li key={i}>{f.staffLedger} — {f.error}</li>)}
                    </ul>
                  </div>
                ) : null}
                {!postResult.posted && postResult.error && <>✗ {postResult.error}</>}
              </div>
            )}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setPreview(null)} disabled={postBusy}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600">Close</button>
              <button onClick={postJournal} disabled={postBusy || preview.legs.length === 0 || (postResult?.ok ?? false)}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white">
                {postBusy ? 'Posting…' : postResult?.ok ? '✓ Posted' : `🚀 Post to ${firm} Tally`}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {paymentPreview && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={() => !paymentPostBusy && setPaymentPreview(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-base font-semibold">Payment Vouchers Preview — {firm} · {paymentPreview.monthKey}</h2>
              <button onClick={() => setPaymentPreview(null)} disabled={paymentPostBusy} className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 text-xl leading-none">×</button>
            </div>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Voucher Date</label>
                <input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Bank Ledger (Cr)</label>
                <input value={bankLedger} onChange={(e) => setBankLedger(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800 font-mono text-xs" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase mb-1">Narration</label>
                <input value={narration} onChange={(e) => setNarration(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800" />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left">Staff Name</th>
                    <th className="px-3 py-2 text-left">Tally Ledger</th>
                    <th className="px-3 py-2 text-right">Net Payable</th>
                    <th className="px-3 py-2 text-left">Bank Account Details (A/c, IFSC, Bank)</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentPreview.legs.map((l) => {
                    const b = bankDetailsMap[l.staffLedger.toLowerCase().trim()]
                    const hasBank = !!(b?.accountNumber && b?.ifsc)
                    return (
                      <tr key={l.entryId} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-3 py-1.5 font-medium">{l.staffName}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-500">{l.staffLedger}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{fmtINR(l.amount)}</td>
                        <td className="px-3 py-1.5">
                          {hasBank ? (
                            <div className="text-gray-700 dark:text-gray-300">
                              <span className="font-semibold font-mono text-xs">{b.accountNumber}</span>
                              <span className="mx-1 text-gray-400">|</span>
                              <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{b.ifsc}</span>
                              <span className="mx-1 text-gray-400">|</span>
                              <span className="text-[11px] text-gray-500">{b.bankName}</span>
                            </div>
                          ) : (
                            <span className="text-red-500 font-semibold">Missing Bank Details in Tally!</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {hasBank ? (
                            <span className="badge badge-green">Ready</span>
                          ) : (
                            <span className="badge badge-red font-semibold">Missing Bank</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 dark:bg-gray-800 font-bold border-t-2 border-gray-300 dark:border-gray-600">
                    <td className="px-3 py-2" colSpan={2}>TOTAL PAYABLE</td>
                    <td className="px-3 py-2 text-right">{fmtINR(paymentPreview.total)}</td>
                    <td className="px-3 py-2" colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
              {paymentPreview.skipped.length > 0 && (
                <div className="p-3 bg-amber-50/40 dark:bg-amber-900/10 border-t border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">{paymentPreview.skipped.length} skipped (no Tally ledger set):</p>
                  <ul className="text-xs text-gray-600 dark:text-gray-400 list-disc pl-5">
                    {paymentPreview.skipped.slice(0, 10).map((s, i) => <li key={i}>{s.staffName}</li>)}
                    {paymentPreview.skipped.length > 10 && <li>… +{paymentPreview.skipped.length - 10} more</li>}
                  </ul>
                </div>
              )}
            </div>
            {paymentPostResult && (
              <div className={`px-4 py-2 text-sm ${paymentPostResult.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300'}`}>
                {paymentPostResult.ok
                  ? <>✓ Posted {paymentPostResult.posted} payment vouchers, total {fmtINR(paymentPostResult.total || 0)}. Tally voucher: <strong>{paymentPostResult.paymentVoucherNo}</strong></>
                  : <>✗ {paymentPostResult.error}</>}
              </div>
            )}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setPaymentPreview(null)} disabled={paymentPostBusy}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600">Close</button>
              <button onClick={postPayments} disabled={paymentPostBusy || paymentPreview.legs.length === 0 || (paymentPostResult?.ok ?? false) || paymentPreview.legs.some(l => {
                const b = bankDetailsMap[l.staffLedger.toLowerCase().trim()];
                return !b || !b.accountNumber || !b.ifsc;
              })}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white">
                {paymentPostBusy ? 'Posting…' : paymentPostResult?.ok ? '✓ Posted' : `🚀 Post Payments to ${firm} Tally`}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Sub-components

function SectionHeader({ kind, name, isOpen, onToggle, rowCount, balance, onToggleHide }: {
  kind: 'standalone' | 'contractor'
  name: string
  isOpen: boolean
  onToggle: () => void
  rowCount: number
  balance?: ContractorBalance
  onToggleHide?: () => void
}) {
  return (
    <div onClick={onToggle}
      className="px-4 py-2.5 flex items-center justify-between cursor-pointer bg-gradient-to-r from-indigo-50 to-transparent dark:from-indigo-900/20 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-3">
        <span className={`inline-block text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>&#9654;</span>
        <span className="font-semibold text-sm">{kind === 'contractor' ? `Contractor · ${name}` : name}</span>
        <span className="badge badge-gray">{rowCount} staff</span>
        {onToggleHide && (
          <button onClick={(e) => { e.stopPropagation(); onToggleHide() }}
            title={balance?.hiddenInWages ? 'Unhide this contractor in the wages page' : 'Hide this contractor on the wages page (persists across sessions)'}
            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800">
            {balance?.hiddenInWages ? '👁 Unhide' : '🙈 Hide'}
          </button>
        )}
      </div>
      {balance && (
        <div className="text-xs text-gray-600 dark:text-gray-400 flex gap-4">
          <span>Pool <span className="font-semibold text-gray-900 dark:text-gray-100">{fmtINR(balance.openingCarry + balance.jobsTotal)}</span></span>
          <span>Distributed <span className="font-semibold text-gray-900 dark:text-gray-100">{fmtINR(balance.distributed)}</span></span>
          <span>Carry <span className={`font-semibold ${Math.abs(balance.closingCarry) < 1 ? 'text-emerald-600' : balance.closingCarry < 0 ? 'text-red-600' : 'text-amber-600'}`}>{fmtINR(balance.closingCarry)}</span></span>
        </div>
      )}
    </div>
  )
}

function ProcessJobsEditor({ balance, onAdd, onDelete, onUpdateQty }: {
  balance: ContractorBalance
  onAdd: (j: { processName: string; quality?: string; rate: number; quantity: number }) => void
  onDelete: (jobId: string) => void
  onUpdateQty: (jobId: string, quantity: number) => void
}) {
  const [adding, setAdding] = useState(false)
  const [processName, setProcessName] = useState('')
  const [quality, setQuality] = useState('')
  const [rate, setRate] = useState('')
  const [quantity, setQuantity] = useState('')

  function submit() {
    const r = Number(rate) || 0
    const q = Number(quantity) || 0
    if (!processName.trim() || r <= 0 || q <= 0) { alert('Process, rate, quantity all required'); return }
    onAdd({ processName: processName.trim(), quality: quality.trim() || undefined, rate: r, quantity: q })
    setProcessName(''); setQuality(''); setRate(''); setQuantity(''); setAdding(false)
  }

  // Match each template to a job for this month (by name + quality + rate).
  // If matched: render the job's qty editable; if not: show empty qty input
  // that creates a job on entry.
  function jobForTemplate(t: JobTemplate) {
    return balance.jobs.find((j) =>
      j.processName === t.processName
      && (j.quality || '') === (t.quality || '')
      && Math.abs(j.rate - t.rate) < 0.001
    )
  }
  const manualJobs = balance.jobs.filter((j) => !balance.jobTemplates.some((t) =>
    t.processName === j.processName
    && (t.quality || '') === (j.quality || '')
    && Math.abs(t.rate - j.rate) < 0.001
  ))

  return (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-800/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Process Jobs (this month)
          {balance.jobTemplates.length > 0 && <span className="ml-2 text-[10px] font-normal text-gray-400">{balance.jobTemplates.length} template{balance.jobTemplates.length === 1 ? '' : 's'} · only enter qty</span>}
        </span>
        <button onClick={() => setAdding((v) => !v)}
          className="text-xs font-semibold px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white">
          {adding ? '× Cancel' : '+ Add Job'}
        </button>
      </div>

      {balance.jobTemplates.length === 0 && balance.jobs.length === 0 && !adding && (
        <p className="text-xs text-gray-400 italic">No process jobs or templates yet. Add a template in the Contractors page so this contractor&apos;s jobs auto-appear each month, or click + Add Job for a one-off.</p>
      )}

      {(balance.jobTemplates.length > 0 || balance.jobs.length > 0) && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs mb-2">
            <thead>
              <tr className="text-gray-500">
                <th className="px-2 py-1 text-left">Process</th>
                <th className="px-2 py-1 text-left">Quality</th>
                <th className="px-2 py-1 text-right">Rate</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Total</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {balance.jobTemplates.map((t) => {
                const job = jobForTemplate(t)
                return (
                  <TemplateJobRow
                    key={t.id}
                    template={t}
                    job={job}
                    onCreate={(qty) => onAdd({ processName: t.processName, quality: t.quality || undefined, rate: t.rate, quantity: qty })}
                    onUpdate={(qty) => job && onUpdateQty(job.id, qty)}
                    onDelete={() => job && onDelete(job.id)}
                  />
                )
              })}
              {manualJobs.map((j) => (
                <tr key={j.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1">{j.processName}</td>
                  <td className="px-2 py-1">{j.quality || '—'}</td>
                  <td className="px-2 py-1 text-right">{j.rate.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right">{j.quantity}</td>
                  <td className="px-2 py-1 text-right font-semibold">{fmtINR(j.total)}</td>
                  <td className="px-2 py-1 text-right">
                    <button onClick={() => onDelete(j.id)} className="text-red-600 hover:text-red-800 text-sm">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end pt-2 border-t border-gray-200 dark:border-gray-700">
          <input value={processName} onChange={(e) => setProcessName(e.target.value)} placeholder="Process (e.g. Checking)"
            className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-800" />
          <input value={quality} onChange={(e) => setQuality(e.target.value)} placeholder="Quality (optional)"
            className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-800" />
          <input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate"
            className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-xs text-right bg-white dark:bg-gray-800" />
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Quantity"
            className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-xs text-right bg-white dark:bg-gray-800" />
          <button onClick={submit}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white">Save Job</button>
        </div>
      )}
    </div>
  )
}

// One template row — the typical case where the user only types qty.
// If a job already exists for this (template, month), the qty edits it.
// If qty goes to 0, the job is deleted. If a qty is typed into an empty
// template row, a new job is created.
function TemplateJobRow({ template, job, onCreate, onUpdate, onDelete }: {
  template: JobTemplate
  job?: { id: string; quantity: number; total: number }
  onCreate: (qty: number) => void
  onUpdate: (qty: number) => void
  onDelete: () => void
}) {
  const [qtyStr, setQtyStr] = useState(job ? String(job.quantity) : '')
  // Keep input in sync if the server response brings back a different number.
  useEffect(() => { setQtyStr(job ? String(job.quantity) : '') }, [job?.id, job?.quantity])

  function commit() {
    const qty = Number(qtyStr) || 0
    if (job) {
      if (qty <= 0) onDelete()
      else if (qty !== job.quantity) onUpdate(qty)
    } else if (qty > 0) {
      onCreate(qty)
    }
  }

  const total = job ? job.total : template.rate * (Number(qtyStr) || 0)
  return (
    <tr className={`border-t border-gray-100 dark:border-gray-800 ${job ? '' : 'bg-blue-50/20 dark:bg-blue-900/10'}`}>
      <td className="px-2 py-1">{template.processName}</td>
      <td className="px-2 py-1">{template.quality || '—'}</td>
      <td className="px-2 py-1 text-right">{template.rate.toFixed(2)}</td>
      <td className="px-2 py-1 text-right">
        <input type="number" min={0} value={qtyStr}
          onChange={(e) => setQtyStr(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder="qty"
          className="w-20 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-right text-xs bg-white dark:bg-gray-800" />
      </td>
      <td className="px-2 py-1 text-right font-semibold">{fmtINR(total)}</td>
      <td className="px-2 py-1 text-right">
        {job && <button onClick={onDelete} title="Clear qty (deletes this month's job, keeps the template)"
          className="text-red-600 hover:text-red-800 text-sm">×</button>}
      </td>
    </tr>
  )
}

function ContractorBalanceFooter({ balance }: { balance: ContractorBalance }) {
  const carryColor = Math.abs(balance.closingCarry) < 1
    ? 'text-emerald-600'
    : balance.closingCarry < 0 ? 'text-red-600' : 'text-amber-600'
  return (
    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-700 text-xs flex flex-wrap justify-end gap-x-4 gap-y-1.5 text-right">
      <span>Opening carry: <strong className="text-gray-900 dark:text-gray-100">{fmtINR(balance.openingCarry)}</strong></span>
      <span>+ Jobs total: <strong className="text-gray-900 dark:text-gray-100">{fmtINR(balance.jobsTotal)}</strong></span>
      <span>= Pool: <strong className="text-gray-900 dark:text-gray-100">{fmtINR(balance.openingCarry + balance.jobsTotal)}</strong></span>
      <span>− Distributed: <strong className="text-gray-900 dark:text-gray-100">{fmtINR(balance.distributed)}</strong></span>
      <span>= Carry → next month: <strong className={carryColor}>{fmtINR(balance.closingCarry)}</strong></span>
    </div>
  )
}

// Salaried analogue of ContractorBalanceFooter: sums the per-staff
// running balance across every row in the Standalone section.
function StandaloneCarryFooter({ rows }: { rows: Row[] }) {
  const openingCarry = rows.reduce((s, r) => s + (r.openingCarry || 0), 0)
  const target = rows.reduce((s, r) => s + (r.target || 0), 0)
  const paid = rows.reduce((s, r) => s + (r.calculatedWage || 0), 0)
  const closingCarry = rows.reduce((s, r) => s + (r.closingCarry || 0), 0)
  const carryColor = Math.abs(closingCarry) < 1
    ? 'text-emerald-600'
    : closingCarry < 0 ? 'text-red-600' : 'text-amber-600'
  return (
    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-700 text-xs flex flex-wrap justify-end gap-x-4 gap-y-1.5 text-right">
      <span>Opening carry: <strong className="text-gray-900 dark:text-gray-100">{fmtINR(openingCarry)}</strong></span>
      <span>+ Target salaries: <strong className="text-gray-900 dark:text-gray-100">{fmtINR(target)}</strong></span>
      <span>− Paid (calc wage): <strong className="text-gray-900 dark:text-gray-100">{fmtINR(paid)}</strong></span>
      <span>= Carry → next month: <strong className={carryColor}>{fmtINR(closingCarry)}</strong></span>
    </div>
  )
}

function AllocationRow({ row, contractorId, liveMonthDays, onChange, onChangeAdvance, saving, isSelected, onToggleSelect, onResetPosted }: {
  row: Row
  contractorId: string
  liveMonthDays: number // current month's days from the URL (not the entry's stored value)
  onChange: (patch: Partial<Allocation>) => void
  onChangeAdvance: (v: number) => void
  saving: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onResetPosted: (kind: 'journal' | 'payment' | 'both') => void
}) {
  const alloc = row.allocations.find((a) => a.contractorId === contractorId)
  const share = alloc?.share ?? 0
  const days = alloc?.daysWorked ?? 0
  const strategy: 'SHARE_FIRST' | 'DAYS_FIRST' = alloc?.strategy ?? 'SHARE_FIRST'

  // Local in-progress edit state — the share/days/advance inputs are
  // uncontrolled while focused, so the auto-reload after each save can't
  // overwrite the digits the user is currently typing. Commit on blur/Enter.
  const [shareStr, setShareStr] = useState(String(Math.round(share)))
  const [daysStr, setDaysStr] = useState(String(days))
  const [advStr, setAdvStr] = useState(String(row.staffAdvance))
  const shareRef = useRef<HTMLInputElement>(null)
  const daysRef = useRef<HTMLInputElement>(null)
  const advRef = useRef<HTMLInputElement>(null)
  // Re-sync when server data changes — but only if the user is NOT currently
  // editing that field (otherwise their typing would get clobbered).
  useEffect(() => {
    if (document.activeElement !== shareRef.current) setShareStr(String(Math.round(share)))
  }, [share])
  useEffect(() => {
    if (document.activeElement !== daysRef.current) setDaysStr(String(days))
  }, [days])
  useEffect(() => {
    if (document.activeElement !== advRef.current) setAdvStr(String(row.staffAdvance))
  }, [row.staffAdvance])

  function commitShare() {
    const v = Number(shareStr) || 0
    if (Math.round(v) !== Math.round(share)) onChange({ strategy: 'SHARE_FIRST', share: v })
  }
  function commitDays() {
    const v = Number(daysStr) || 0
    if (v !== days) onChange({ strategy: 'DAYS_FIRST', daysWorked: v })
  }
  function commitAdvance() {
    const v = Number(advStr) || 0
    if (v !== row.staffAdvance) onChangeAdvance(v)
  }

  return (
    <tr className={`border-t border-gray-100 dark:border-gray-800 ${row.postedToTally ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : ''}`}>
      <td className="px-2 py-1.5 text-center w-8">
        {row.entryId && ((!row.postedToTally && row.calculatedWage > 0) || (!row.paymentPostedToTally && row.netPayable > 0)) ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
        ) : (
          <input
            type="checkbox"
            checked={row.postedToTally || row.paymentPostedToTally}
            disabled
            className="rounded border-gray-200 dark:border-gray-700 text-gray-400 opacity-50"
          />
        )}
      </td>
      <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{row.code}</td>
      <td className="px-2 py-1.5">
        <div className="font-medium flex items-center gap-1.5">
          <span>{row.name}</span>
          {row.inRegister && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="On the official Salary Register">Reg</span>}
          {/* Tally-match badge — only when ledger name SET and last sync
              explicitly returned not-found. Found-in-Tally is the silent
              default (no badge clutter). */}
          {row.tallyLedgerName && row.tallyLedgerFound === false && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap"
              title={`Tally ledger "${row.tallyLedgerName}" NOT found in Tally at last sync${row.tallyLedgerSyncedAt ? ' (' + new Date(row.tallyLedgerSyncedAt).toLocaleString('en-IN') + ')' : ''}. Fix the spelling in Staff Register or in Tally.`}>
              NA in Tally
            </span>
          )}
        </div>
        {row.department && <div className="text-[10px] text-gray-500">{row.department}</div>}
      </td>
      <td className="px-2 py-1.5 text-right font-semibold">{fmtINR(row.monthlyBaseSalary)}</td>
      <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-300" title={`${row.monthlyBaseSalary} ÷ ${liveMonthDays} = ${(row.monthlyBaseSalary / liveMonthDays).toFixed(2)}`}>{fmtDailyRate(row.dailyRate)}</td>
      <td className="px-2 py-1.5 text-center">
        <div className="inline-flex items-center gap-1">
          <button onClick={() => { setDaysStr(String(Math.max(0, days - 0.5))); onChange({ strategy: 'DAYS_FIRST', daysWorked: Math.max(0, days - 0.5) }) }}
            className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 text-sm leading-none hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">−</button>
          <input type="number" step="0.5" min={0} max={liveMonthDays}
            ref={daysRef} value={daysStr}
            onChange={(e) => setDaysStr(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commitDays}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="w-14 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-center text-sm bg-white dark:bg-gray-800" />
          <button onClick={() => { setDaysStr(String(Math.min(liveMonthDays, days + 0.5))); onChange({ strategy: 'DAYS_FIRST', daysWorked: Math.min(liveMonthDays, days + 0.5) }) }}
            className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 text-sm leading-none hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">+</button>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        <input type="number" min={0}
          ref={shareRef} value={shareStr}
          onChange={(e) => setShareStr(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitShare}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="w-28 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-right text-sm font-semibold bg-white dark:bg-gray-800" />
      </td>
      <td className="px-2 py-1.5 text-center">
        <select value={strategy} onChange={(e) => onChange({ strategy: e.target.value as 'SHARE_FIRST' | 'DAYS_FIRST' })}
          className="px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-[10px] bg-white dark:bg-gray-800">
          <option value="SHARE_FIRST">Share→Days</option>
          <option value="DAYS_FIRST">Days→Share</option>
        </select>
      </td>
      <td className="px-2 py-1.5 text-right">
        <input type="number" min={0}
          ref={advRef} value={advStr}
          onChange={(e) => setAdvStr(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitAdvance}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="w-20 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-right text-sm bg-white dark:bg-gray-800" />
      </td>
      <td className="px-2 py-1.5 text-right font-bold">{fmtINR(row.netPayable)}</td>
      <td className="px-2 py-1.5 text-center text-xs">
        <div className="flex flex-col items-center gap-1 justify-center">
          {row.postedToTally ? (
            <span className="badge badge-green flex items-center gap-1" title={`Journal No: ${row.journalNo}`}>
              Posted
              <button onClick={() => onResetPosted('journal')} title="Reset Posted status (use if you deleted the voucher in Tally)" className="text-[10px] hover:text-red-700">↺</button>
            </span>
          ) : saving ? (
            <span className="text-amber-600">Saving…</span>
          ) : row.entryId ? (
            <span className="badge badge-gray">Ready</span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
          {row.paymentPostedToTally && (
            <span className="badge badge-blue flex items-center gap-1" title={`Payment Voucher No: ${row.paymentVoucherNo}`}>
              Paid
              <button onClick={() => onResetPosted('payment')} title="Reset Paid status (use if you deleted the payment voucher in Tally)" className="text-[10px] hover:text-red-700">↺</button>
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}

function MobileStandaloneRow({ row, liveMonthDays, onChange, saving, isSelected, onToggleSelect, onResetPosted }: {
  row: Row
  liveMonthDays: number
  onChange: (patch: { daysWorked?: number; actualDaysWorked?: number; staffAdvance?: number }) => void
  saving: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onResetPosted: (kind: 'journal' | 'payment' | 'both') => void
}) {
  const isActual = row.actualSalary !== null && row.actualSalary > 0
  const days = row.daysWorked ?? 0
  const actDays = row.actualDaysWorked ?? liveMonthDays
  const [daysStr, setDaysStr] = useState(String(days))
  const [actDaysStr, setActDaysStr] = useState(String(actDays))
  const [advStr, setAdvStr] = useState(String(row.staffAdvance))
  const daysRef = useRef<HTMLInputElement>(null)
  const actDaysRef = useRef<HTMLInputElement>(null)
  const advRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== daysRef.current) setDaysStr(String(days))
  }, [days])
  useEffect(() => {
    if (document.activeElement !== actDaysRef.current) setActDaysStr(String(actDays))
  }, [actDays])
  useEffect(() => {
    if (document.activeElement !== advRef.current) setAdvStr(String(row.staffAdvance))
  }, [row.staffAdvance])

  function commitDays() {
    const v = Number(daysStr) || 0
    if (v !== days) onChange({ daysWorked: v })
  }
  function commitActDays() {
    const v = Number(actDaysStr) || 0
    if (v !== actDays) onChange({ actualDaysWorked: v })
  }
  function commitAdv() {
    const v = Number(advStr) || 0
    if (v !== row.staffAdvance) onChange({ staffAdvance: v })
  }

  const targetPayout = isActual ? ((row.actualSalary || 0) / 30) * actDays : 0

  return (
    <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm flex flex-col gap-3 relative transition-colors ${row.postedToTally ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800/60' : ''}`}>
      {/* Selection + Code + Name + Badges */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="pt-0.5">
            {row.entryId && ((!row.postedToTally && row.calculatedWage > 0) || (!row.paymentPostedToTally && row.netPayable > 0)) ? (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
            ) : (
              <input
                type="checkbox"
                checked={row.postedToTally || row.paymentPostedToTally}
                disabled
                className="w-5 h-5 rounded border-gray-200 dark:border-gray-700 text-gray-400 opacity-50"
              />
            )}
          </div>
          <div>
            <span className="font-mono text-xs text-gray-500 block">Code: {row.code}</span>
            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1.5 flex-wrap">
              {row.name}
              {row.inRegister && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="On the official Salary Register">Reg</span>}
              {row.tallyLedgerName && row.tallyLedgerFound === false && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  title={`Tally ledger "${row.tallyLedgerName}" NOT found in Tally`}>
                  NA in Tally
                </span>
              )}
            </span>
            {row.department && <span className="text-xs text-gray-500 block">{row.department}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {row.postedToTally ? (
            <span className="badge badge-green flex items-center gap-1 text-[10px]" title={`Journal No: ${row.journalNo}`}>
              Posted
              <button onClick={() => onResetPosted('journal')} className="text-[10px] hover:text-red-700">↺</button>
            </span>
          ) : saving ? (
            <span className="text-xs text-amber-600">Saving…</span>
          ) : row.entryId ? (
            <span className="badge badge-gray text-[10px]">Ready</span>
          ) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
          {row.paymentPostedToTally && (
            <span className="badge badge-blue flex items-center gap-1 text-[10px]" title={`Payment Voucher No: ${row.paymentVoucherNo}`}>
              Paid
              <button onClick={() => onResetPosted('payment')} className="text-[10px] hover:text-red-700">↺</button>
            </span>
          )}
        </div>
      </div>

      {/* Salary Info Panel */}
      <div className="grid grid-cols-2 gap-3 bg-gray-50 dark:bg-gray-800/50 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700 text-xs">
        <div>
          <span className="text-[10px] uppercase font-bold text-gray-400 block mb-0.5">Register Salary</span>
          <div className="font-semibold text-gray-800 dark:text-gray-200">{fmtINR(row.monthlyBaseSalary)}</div>
          <div className="text-[10px] text-gray-500">Rate: {fmtDailyRate(row.dailyRate)}/day</div>
        </div>
        {isActual ? (
          <div>
            <span className="text-[10px] uppercase font-bold text-indigo-400 dark:text-indigo-300 block mb-0.5">Actual Salary</span>
            <div className="font-semibold text-indigo-600 dark:text-indigo-400">{fmtINR(row.actualSalary || 0)}</div>
            <div className="text-[10px] text-indigo-500">Rate: {fmtDailyRate((row.actualSalary || 0) / 30)}/day</div>
          </div>
        ) : (
          <div className="flex items-center text-[10px] text-gray-400 italic">No Actual Salary</div>
        )}
      </div>

      {/* Inputs (steppers for days + advance) */}
      <div className="grid grid-cols-2 gap-3 items-end">
        {/* Days Stepper */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-semibold">{isActual ? 'Actual Days Worked' : 'Days Worked'}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (isActual) {
                  const v = Math.max(0, actDays - 0.5)
                  setActDaysStr(String(v))
                  onChange({ actualDaysWorked: v })
                } else {
                  const v = Math.max(0, days - 0.5)
                  setDaysStr(String(v))
                  onChange({ daysWorked: v })
                }
              }}
              className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 text-base font-bold flex items-center justify-center bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 active:bg-gray-200 dark:hover:bg-gray-600"
            >
              −
            </button>
            <input
              type="number"
              step="0.5"
              min={0}
              max={liveMonthDays}
              ref={isActual ? actDaysRef : daysRef}
              value={isActual ? actDaysStr : daysStr}
              onChange={(e) => (isActual ? setActDaysStr(e.target.value) : setDaysStr(e.target.value))}
              onFocus={(e) => e.target.select()}
              onBlur={isActual ? commitActDays : commitDays}
              className="w-14 h-8 border border-gray-300 dark:border-gray-600 rounded-lg text-center text-sm bg-white dark:bg-gray-800 font-semibold"
            />
            <button
              onClick={() => {
                if (isActual) {
                  const v = Math.min(liveMonthDays, actDays + 0.5)
                  setActDaysStr(String(v))
                  onChange({ actualDaysWorked: v })
                } else {
                  const v = Math.min(liveMonthDays, days + 0.5)
                  setDaysStr(String(v))
                  onChange({ daysWorked: v })
                }
              }}
              className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 text-base font-bold flex items-center justify-center bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 active:bg-gray-200 dark:hover:bg-gray-600"
            >
              +
            </button>
          </div>
          {isActual && (
            <span className="text-[10px] text-gray-500 mt-0.5">
              Solved Reg: <strong className="text-gray-700 dark:text-gray-300">{row.daysWorked ?? 0} days</strong>
            </span>
          )}
        </div>

        {/* Advance Input */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-semibold">Staff Advance (₹)</span>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
            <input
              type="number"
              min={0}
              ref={advRef}
              value={advStr}
              onChange={(e) => setAdvStr(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commitAdv}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="w-full h-8 border border-gray-300 dark:border-gray-600 rounded-lg pl-6 pr-2 text-right text-sm bg-white dark:bg-gray-800 font-semibold"
            />
          </div>
        </div>
      </div>

      {/* Target & Carry Metrics (Only shown if worked on or carries exist) */}
      {(row.calculatedWage > 0 || Math.abs(row.openingCarry) > 0.5) && (
        <div className="grid grid-cols-3 gap-2 border-t border-gray-100 dark:border-gray-700 pt-2.5 text-[10px] text-gray-500">
          <div>
            <span className="block text-gray-400">TARGET</span>
            <strong className="text-gray-700 dark:text-gray-300">{fmtINR(row.target)}</strong>
          </div>
          <div>
            <span className="block text-gray-400">DIFF</span>
            <strong className={`font-semibold ${Math.abs(row.diff) < 1 ? 'text-emerald-600' : row.diff > 0 ? 'text-amber-600' : 'text-red-600'}`}>
              {fmtINR(row.diff)}
            </strong>
          </div>
          <div>
            <span className="block text-gray-400">CARRY</span>
            <strong className={`font-semibold ${Math.abs(row.closingCarry) < 1 ? 'text-emerald-600' : row.closingCarry > 0 ? 'text-blue-600' : 'text-red-600'}`}>
              {fmtINR(row.closingCarry)}
            </strong>
          </div>
        </div>
      )}

      {/* Footer Details: Mode, Calculated Register Wage, and Net Payable */}
      <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-2.5 text-xs">
        <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
          {isActual ? 'direct (actual)' : 'direct'}
        </span>
        <div className="text-right">
          <div className="text-gray-500 text-[10px]">
            Calc: <strong>{fmtINR(row.calculatedWage)}</strong>
            {isActual && <span className="ml-1.5 text-gray-400 font-normal">(Target: {fmtINR(targetPayout)})</span>}
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-0.5">
            Net: <span className="text-indigo-600 dark:text-indigo-400 font-extrabold">{fmtINR(row.netPayable)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MobileAllocationRow({ row, contractorId, liveMonthDays, onChange, onChangeAdvance, saving, isSelected, onToggleSelect, onResetPosted }: {
  row: Row
  contractorId: string
  liveMonthDays: number
  onChange: (patch: Partial<Allocation>) => void
  onChangeAdvance: (v: number) => void
  saving: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onResetPosted: (kind: 'journal' | 'payment' | 'both') => void
}) {
  const alloc = row.allocations.find((a) => a.contractorId === contractorId)
  const share = alloc?.share ?? 0
  const days = alloc?.daysWorked ?? 0
  const strategy: 'SHARE_FIRST' | 'DAYS_FIRST' = alloc?.strategy ?? 'SHARE_FIRST'

  const [shareStr, setShareStr] = useState(String(Math.round(share)))
  const [daysStr, setDaysStr] = useState(String(days))
  const [advStr, setAdvStr] = useState(String(row.staffAdvance))
  const shareRef = useRef<HTMLInputElement>(null)
  const daysRef = useRef<HTMLInputElement>(null)
  const advRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== shareRef.current) setShareStr(String(Math.round(share)))
  }, [share])
  useEffect(() => {
    if (document.activeElement !== daysRef.current) setDaysStr(String(days))
  }, [days])
  useEffect(() => {
    if (document.activeElement !== advRef.current) setAdvStr(String(row.staffAdvance))
  }, [row.staffAdvance])

  function commitShare() {
    const v = Number(shareStr) || 0
    if (Math.round(v) !== Math.round(share)) onChange({ strategy: 'SHARE_FIRST', share: v })
  }
  function commitDays() {
    const v = Number(daysStr) || 0
    if (v !== days) onChange({ strategy: 'DAYS_FIRST', daysWorked: v })
  }
  function commitAdvance() {
    const v = Number(advStr) || 0
    if (v !== row.staffAdvance) onChangeAdvance(v)
  }

  return (
    <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm flex flex-col gap-3 relative transition-colors ${row.postedToTally ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-800/60' : ''}`}>
      {/* Selection + Code + Name + Badges */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="pt-0.5">
            {row.entryId && ((!row.postedToTally && row.calculatedWage > 0) || (!row.paymentPostedToTally && row.netPayable > 0)) ? (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
            ) : (
              <input
                type="checkbox"
                checked={row.postedToTally || row.paymentPostedToTally}
                disabled
                className="w-5 h-5 rounded border-gray-200 dark:border-gray-700 text-gray-400 opacity-50"
              />
            )}
          </div>
          <div>
            <span className="font-mono text-xs text-gray-500 block">Code: {row.code}</span>
            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 flex items-center gap-1.5 flex-wrap">
              {row.name}
              {row.inRegister && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="On the official Salary Register">Reg</span>}
              {row.tallyLedgerName && row.tallyLedgerFound === false && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  title={`Tally ledger "${row.tallyLedgerName}" NOT found in Tally`}>
                  NA in Tally
                </span>
              )}
            </span>
            {row.department && <span className="text-xs text-gray-500 block">{row.department}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {row.postedToTally ? (
            <span className="badge badge-green flex items-center gap-1 text-[10px]" title={`Journal No: ${row.journalNo}`}>
              Posted
              <button onClick={() => onResetPosted('journal')} className="text-[10px] hover:text-red-700">↺</button>
            </span>
          ) : saving ? (
            <span className="text-xs text-amber-600">Saving…</span>
          ) : row.entryId ? (
            <span className="badge badge-gray text-[10px]">Ready</span>
          ) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
          {row.paymentPostedToTally && (
            <span className="badge badge-blue flex items-center gap-1 text-[10px]" title={`Payment Voucher No: ${row.paymentVoucherNo}`}>
              Paid
              <button onClick={() => onResetPosted('payment')} className="text-[10px] hover:text-red-700">↺</button>
            </span>
          )}
        </div>
      </div>

      {/* Salary Info Panel */}
      <div className="grid grid-cols-2 gap-3 bg-gray-50 dark:bg-gray-800/50 p-2 rounded-lg border border-gray-100 dark:border-gray-700 text-xs">
        <div>
          <span className="text-[10px] uppercase font-bold text-gray-400 block mb-0.5">Register Salary</span>
          <div className="font-semibold text-gray-800 dark:text-gray-200">{fmtINR(row.monthlyBaseSalary)}</div>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-gray-400 block mb-0.5">Daily Rate</span>
          <div className="font-semibold text-gray-800 dark:text-gray-200">{fmtDailyRate(row.dailyRate)}/day</div>
        </div>
      </div>

      {/* Strategy Selector (Full Width) */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500 font-semibold">Calculation Strategy</span>
        <select
          value={strategy}
          onChange={(e) => onChange({ strategy: e.target.value as 'SHARE_FIRST' | 'DAYS_FIRST' })}
          className="w-full h-8 px-2 border border-gray-300 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-800"
        >
          <option value="SHARE_FIRST">Share → Days (Enter ₹, system solves days)</option>
          <option value="DAYS_FIRST">Days → Share (Enter days, system solves ₹)</option>
        </select>
      </div>

      {/* Interactive Controls Grid */}
      <div className="grid grid-cols-2 gap-3 items-end">
        {/* Days Worked Stepper */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-semibold">Days Allocated</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const v = Math.max(0, days - 0.5)
                setDaysStr(String(v))
                onChange({ strategy: 'DAYS_FIRST', daysWorked: v })
              }}
              className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 text-base font-bold flex items-center justify-center bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 active:bg-gray-200 dark:hover:bg-gray-600"
            >
              −
            </button>
            <input
              type="number"
              step="0.5"
              min={0}
              max={liveMonthDays}
              ref={daysRef}
              value={daysStr}
              onChange={(e) => setDaysStr(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commitDays}
              className="w-14 h-8 border border-gray-300 dark:border-gray-600 rounded-lg text-center text-sm bg-white dark:bg-gray-800 font-semibold"
            />
            <button
              onClick={() => {
                const v = Math.min(liveMonthDays, days + 0.5)
                setDaysStr(String(v))
                onChange({ strategy: 'DAYS_FIRST', daysWorked: v })
              }}
              className="w-8 h-8 rounded-lg border border-gray-300 dark:border-gray-600 text-base font-bold flex items-center justify-center bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 active:bg-gray-200 dark:hover:bg-gray-600"
            >
              +
            </button>
          </div>
        </div>

        {/* Share Input */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-semibold">Share Amount (₹)</span>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
            <input
              type="number"
              min={0}
              ref={shareRef}
              value={shareStr}
              onChange={(e) => setShareStr(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commitShare}
              className="w-full h-8 border border-gray-300 dark:border-gray-600 rounded-lg pl-6 pr-2 text-right text-sm bg-white dark:bg-gray-800 font-semibold"
            />
          </div>
        </div>
      </div>

      {/* Advance input and Net Payable */}
      <div className="grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-700 pt-2.5 items-center">
        {/* Advance */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase font-bold">Staff Advance</span>
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₹</span>
            <input
              type="number"
              min={0}
              ref={advRef}
              value={advStr}
              onChange={(e) => setAdvStr(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commitAdvance}
              className="w-full h-7 border border-gray-300 dark:border-gray-600 rounded-lg pl-5 pr-1 text-right text-xs bg-white dark:bg-gray-800"
            />
          </div>
        </div>

        {/* Net Payout info */}
        <div className="text-right">
          <div className="text-gray-500 text-[10px]">
            Calculated: <strong>{fmtINR(row.calculatedWage)}</strong>
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-0.5">
            Net: <span className="text-indigo-600 dark:text-indigo-400 font-extrabold">{fmtINR(row.netPayable)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function StandaloneRow({ row, liveMonthDays, onChange, saving, isSelected, onToggleSelect, onResetPosted }: {
  row: Row
  liveMonthDays: number
  onChange: (patch: { daysWorked?: number; actualDaysWorked?: number; staffAdvance?: number }) => void
  saving: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onResetPosted: (kind: 'journal' | 'payment' | 'both') => void
}) {
  const isActual = row.actualSalary !== null && row.actualSalary > 0
  // PRIMARY = register days (drives the wage). SECONDARY = actual days
  // (drives the informational target salary, only shown when actualSalary set).
  const days = row.daysWorked ?? 0
  const actDays = row.actualDaysWorked ?? liveMonthDays
  const [daysStr, setDaysStr] = useState(String(days))
  const [actDaysStr, setActDaysStr] = useState(String(actDays))
  const [advStr, setAdvStr] = useState(String(row.staffAdvance))
  const daysRef = useRef<HTMLInputElement>(null)
  const actDaysRef = useRef<HTMLInputElement>(null)
  const advRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== daysRef.current) setDaysStr(String(days))
  }, [days])
  useEffect(() => {
    if (document.activeElement !== actDaysRef.current) setActDaysStr(String(actDays))
  }, [actDays])
  useEffect(() => {
    if (document.activeElement !== advRef.current) setAdvStr(String(row.staffAdvance))
  }, [row.staffAdvance])

  function commitDays() {
    const v = Number(daysStr) || 0
    if (v !== days) onChange({ daysWorked: v })
  }
  function commitActDays() {
    const v = Number(actDaysStr) || 0
    if (v !== actDays) onChange({ actualDaysWorked: v })
  }
  function commitAdv() {
    const v = Number(advStr) || 0
    if (v !== row.staffAdvance) onChange({ staffAdvance: v })
  }

  const targetPayout = isActual ? ((row.actualSalary || 0) / 30) * actDays : 0

  return (
    <tr className={`border-t border-gray-100 dark:border-gray-800 ${row.postedToTally ? 'bg-emerald-50/30 dark:bg-emerald-900/10' : ''}`}>
      <td className="px-2 py-1.5 text-center w-8">
        {row.entryId && ((!row.postedToTally && row.calculatedWage > 0) || (!row.paymentPostedToTally && row.netPayable > 0)) ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
        ) : (
          <input
            type="checkbox"
            checked={row.postedToTally || row.paymentPostedToTally}
            disabled
            className="rounded border-gray-200 dark:border-gray-700 text-gray-400 opacity-50"
          />
        )}
      </td>
      <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{row.code}</td>
      <td className="px-2 py-1.5">
        <div className="font-medium flex items-center gap-1.5">
          <span>{row.name}</span>
          {row.inRegister && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="On the official Salary Register">Reg</span>}
          {/* Tally-match badge — only when ledger name SET and last sync
              explicitly returned not-found. Found-in-Tally is the silent
              default (no badge clutter). */}
          {row.tallyLedgerName && row.tallyLedgerFound === false && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap"
              title={`Tally ledger "${row.tallyLedgerName}" NOT found in Tally at last sync${row.tallyLedgerSyncedAt ? ' (' + new Date(row.tallyLedgerSyncedAt).toLocaleString('en-IN') + ')' : ''}. Fix the spelling in Staff Register or in Tally.`}>
              NA in Tally
            </span>
          )}
        </div>
        {row.department && <div className="text-[10px] text-gray-500">{row.department}</div>}
      </td>
      <td className="px-2 py-1.5 text-right font-semibold">
        <div>{fmtINR(row.monthlyBaseSalary)}</div>
        {isActual && (
          <div className="text-[10px] text-indigo-600 font-semibold" title={`Actual Salary: ${fmtINR(row.actualSalary || 0)}`}>
            Act: {fmtINR(row.actualSalary || 0)}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-300" title={`${row.monthlyBaseSalary} ÷ ${liveMonthDays} = ${(row.monthlyBaseSalary / liveMonthDays).toFixed(2)}`}>
        <div>{fmtDailyRate(row.dailyRate)}</div>
        {isActual && (
          <div className="text-[10px] text-indigo-600 font-semibold" title={`Actual: ${row.actualSalary} ÷ 30 = ${((row.actualSalary || 0) / 30).toFixed(2)}`}>
            Act: {fmtDailyRate((row.actualSalary || 0) / 30)}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        <div className="flex flex-col items-center gap-0.5">
          <div className="inline-flex items-center gap-1">
            <button onClick={() => { const v = Math.max(0, days - 0.5); setDaysStr(String(v)); onChange({ daysWorked: v }) }}
              className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 text-sm leading-none hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">−</button>
            <input type="number" step="0.5" min={0} max={liveMonthDays}
              ref={daysRef} value={daysStr}
              onChange={(e) => setDaysStr(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commitDays}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              title="Register days — drives the wage posted to Tally"
              className="w-14 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-center text-sm bg-white dark:bg-gray-800" />
            <button onClick={() => { const v = Math.min(liveMonthDays, days + 0.5); setDaysStr(String(v)); onChange({ daysWorked: v }) }}
              className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 text-sm leading-none hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">+</button>
          </div>
          {isActual && (
            <div className="flex items-center gap-1 text-[10px] text-gray-500">
              <span>Act</span>
              <input type="number" step="0.5" min={0} max={liveMonthDays}
                ref={actDaysRef} value={actDaysStr}
                onChange={(e) => setActDaysStr(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={commitActDays}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                title="Actual days worked — drives the Target salary below (informational)"
                className="w-12 px-1 py-0 border border-gray-300 dark:border-gray-600 rounded text-center text-[10px] bg-white dark:bg-gray-800" />
              <span>d</span>
            </div>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right font-semibold">
        <div>{fmtINR(row.calculatedWage)}</div>
        {/* Diff + Carry only shown when the row has actually been worked
            on (wage entered OR a carry inherited from a prior month).
            Otherwise an untouched row would scream "Diff: ₹28,000" simply
            because the user hasn't entered days yet — confusing. */}
        {(row.calculatedWage > 0 || Math.abs(row.openingCarry) > 0.5) && (
          <>
            <div className="text-[10px] text-gray-500 font-normal" title="Target salary this month">
              Target: {fmtINR(row.target)}
            </div>
            <div className={`text-[10px] font-semibold ${Math.abs(row.diff) < 1 ? 'text-emerald-600' : row.diff > 0 ? 'text-amber-600' : 'text-red-600'}`}
              title="Target − Paid (positive = underpaid this month)">
              Diff: {fmtINR(row.diff)}
            </div>
            <div className={`text-[10px] ${Math.abs(row.closingCarry) < 1 ? 'text-emerald-600' : row.closingCarry > 0 ? 'text-blue-600' : 'text-red-600'}`}
              title={`Opening carry ${fmtINR(row.openingCarry)} + Target ${fmtINR(row.target)} − Paid ${fmtINR(row.calculatedWage)}`}>
              Carry: {fmtINR(row.closingCarry)}
            </div>
          </>
        )}
      </td>
      <td className="px-2 py-1.5 text-center text-[10px] text-gray-400">
        {isActual ? '(actual)' : '(direct)'}
      </td>
      <td className="px-2 py-1.5 text-right">
        <input type="number" min={0}
          ref={advRef} value={advStr}
          onChange={(e) => setAdvStr(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitAdv}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="w-20 px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-right text-sm bg-white dark:bg-gray-800" />
      </td>
      <td className="px-2 py-1.5 text-right font-bold">{fmtINR(row.netPayable)}</td>
      <td className="px-2 py-1.5 text-center text-xs">
        <div className="flex flex-col items-center gap-1 justify-center">
          {row.postedToTally ? (
            <span className="badge badge-green flex items-center gap-1" title={`Journal No: ${row.journalNo}`}>
              Posted
              <button onClick={() => onResetPosted('journal')} title="Reset Posted status (use if you deleted the voucher in Tally)" className="text-[10px] hover:text-red-700">↺</button>
            </span>
          ) : saving ? (
            <span className="text-amber-600">Saving…</span>
          ) : row.entryId ? (
            <span className="badge badge-gray">Ready</span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
          {row.paymentPostedToTally && (
            <span className="badge badge-blue flex items-center gap-1" title={`Payment Voucher No: ${row.paymentVoucherNo}`}>
              Paid
              <button onClick={() => onResetPosted('payment')} title="Reset Paid status (use if you deleted the payment voucher in Tally)" className="text-[10px] hover:text-red-700">↺</button>
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}
