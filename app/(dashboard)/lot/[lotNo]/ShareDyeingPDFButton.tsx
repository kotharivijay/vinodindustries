'use client'

import { useState } from 'react'
import { generateMultiSlipPDF, sharePDF, type SlipData } from '@/lib/pdf-share'

export default function ShareDyeingPDFButton({ slips, lotNo }: { slips: SlipData[]; lotNo: string }) {
  const [busy, setBusy] = useState(false)

  if (slips.length === 0) return null

  async function handle() {
    setBusy(true)
    try {
      const blob = generateMultiSlipPDF(slips)
      await sharePDF(blob, `dyeing_${lotNo}_${slips.length}slips.pdf`)
    } catch (err) {
      console.error('PDF share failed', err)
      alert('Failed to share PDF')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={handle}
      disabled={busy}
      className="text-xs font-medium text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 border border-green-200 dark:border-green-700 rounded-lg px-3 py-1.5 disabled:opacity-50"
    >
      {busy ? 'Preparing…' : `📄 Share ${slips.length} Slip${slips.length > 1 ? 's' : ''} PDF`}
    </button>
  )
}
