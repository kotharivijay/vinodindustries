'use client'

import { useEffect } from 'react'

export default function PrintSettings() {
  useEffect(() => {
    try {
      const raw = localStorage.getItem('print-settings')
      if (!raw) return
      const s = JSON.parse(raw)
      const root = document.documentElement
      if (s.headerFontSize) root.style.setProperty('--print-header', s.headerFontSize + 'px')
      if (s.lotFontSize) root.style.setProperty('--print-lot', s.lotFontSize + 'px')
      if (s.labelFontSize) root.style.setProperty('--print-label', s.labelFontSize + 'px')
      if (s.chemFontSize) root.style.setProperty('--print-chem', s.chemFontSize + 'px')
    } catch {}
  }, [])
  return null
}
