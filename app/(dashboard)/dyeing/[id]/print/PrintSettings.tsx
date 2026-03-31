'use client'

import { useEffect } from 'react'

export default function PrintSettings() {
  useEffect(() => {
    try {
      const raw = localStorage.getItem('print-settings')
      if (!raw) return
      const s = JSON.parse(raw)

      // Apply font sizes directly to elements with data attributes
      document.querySelectorAll('[data-print="header"]').forEach(el => {
        (el as HTMLElement).style.fontSize = (s.headerFontSize || 18) + 'px'
      })
      document.querySelectorAll('[data-print="lot"]').forEach(el => {
        (el as HTMLElement).style.fontSize = (s.lotFontSize || 14) + 'px'
      })
      document.querySelectorAll('[data-print="label"]').forEach(el => {
        (el as HTMLElement).style.fontSize = (s.labelFontSize || 13) + 'px'
      })
      document.querySelectorAll('[data-print="chem"]').forEach(el => {
        (el as HTMLElement).style.fontSize = (s.chemFontSize || 12) + 'px'
      })
      document.querySelectorAll('[data-print="info"]').forEach(el => {
        (el as HTMLElement).style.fontSize = (s.chemFontSize || 12) + 'px'
      })

      // Bold settings
      document.querySelectorAll('[data-print-bold="chem-name"]').forEach(el => {
        (el as HTMLElement).style.fontWeight = s.boldChemName !== false ? 'bold' : 'normal'
      })
      document.querySelectorAll('[data-print-bold="quantity"]').forEach(el => {
        (el as HTMLElement).style.fontWeight = s.boldQuantity !== false ? 'bold' : 'normal'
      })
      document.querySelectorAll('[data-print-bold="lot"]').forEach(el => {
        (el as HTMLElement).style.fontWeight = s.boldLotNo !== false ? 'bold' : 'normal'
      })
    } catch {}
  }, [])
  return null
}
