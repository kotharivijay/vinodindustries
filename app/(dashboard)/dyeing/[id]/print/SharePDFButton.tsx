'use client'

import { useState } from 'react'
import { generateSlipPDF, sharePDF, type SlipData } from '@/lib/pdf-share'

export default function SharePDFButton({ slip }: { slip: SlipData }) {
  const [busy, setBusy] = useState(false)

  async function handle() {
    setBusy(true)
    try {
      const blob = generateSlipPDF(slip)
      await sharePDF(blob, `dyeing_slip_${slip.slipNo}.pdf`)
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
      className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
    >
      {busy ? 'Preparing…' : '📄 Share PDF'}
    </button>
  )
}
