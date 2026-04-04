'use client'

import { useState } from 'react'

interface SlipData {
  slipNo: number; date: string; partyName: string | null; shadeName: string | null
  shadeDescription?: string | null; qualityName?: string | null
  machineName: string | null; operatorName: string | null; marka?: string | null; isPcJob?: boolean
  lots: { lotNo: string; than: number }[]; totalThan: number
  chemicals: { name: string; quantity: number | null; unit: string; processTag: string | null }[]
  isReDyed: boolean; totalRounds: number
  additions: {
    roundNo: number; type: string; defectType: string | null; reason: string | null
    machineName: string | null; operatorName: string | null
    chemicals: { name: string; quantity: number | null; unit: string }[]
  }[]
  roundParam: string | number
}

export default function ReceiptPrint({ data }: { data: SlipData }) {
  const [printing, setPrinting] = useState(false)

  function printReceipt() {
    setPrinting(true)

    const showRound = data.roundParam
    const showingSpecific = typeof showRound === 'number' && showRound > 1
    const specificAdd = showingSpecific ? data.additions.find(a => a.roundNo === showRound) : null

    // Group chemicals by processTag
    const grouped: Record<string, typeof data.chemicals> = {}
    for (const c of data.chemicals) {
      const tag = c.processTag || 'Other'
      if (!grouped[tag]) grouped[tag] = []
      grouped[tag].push(c)
    }
    const tagOrder = Object.keys(grouped).sort((a, b) => {
      if (a === 'shade') return -1; if (b === 'shade') return 1
      if (a === 'Other') return 1; if (b === 'Other') return -1
      return a.localeCompare(b)
    })

    const machine = showingSpecific && specificAdd?.machineName ? specificAdd.machineName : data.machineName
    const operator = showingSpecific && specificAdd?.operatorName ? specificAdd.operatorName : data.operatorName

    // Build receipt HTML
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Slip ${data.slipNo}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: monospace, 'Courier New', Courier; font-size: 12px; width: 76mm; color: #000; background: #fff; padding: 2mm; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .big { font-size: 16px; font-weight: bold; }
  .lot { font-size: 15px; font-weight: bold; }
  .chem { font-size: 13px; }
  .chem-name { font-weight: bold; }
  .chem-qty { font-weight: bold; text-align: right; }
  .divider { border-top: 1px dashed #000; margin: 3px 0; }
  .divider2 { border-top: 2px solid #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; padding: 1px 0; }
  .section { font-weight: bold; font-size: 12px; text-transform: uppercase; margin-top: 4px; padding: 2px 0; border-bottom: 1px solid #000; }
  .sign { margin-top: 15px; }
  .sign-line { border-top: 1px solid #000; width: 60%; margin-top: 20px; padding-top: 2px; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 2px; vertical-align: top; }
  .td-name { font-weight: bold; }
  .td-qty { text-align: right; font-weight: bold; white-space: nowrap; }
  .td-unit { white-space: nowrap; color: #555; }
  .td-num { width: 16px; color: #888; }
</style></head><body>`

    html += `<div class="center bold big">KOTHARI SYNTHETIC</div>`
    html += `<div class="center bold big">INDUSTRIES</div>`
    const subtitle = showingSpecific ? `Re-Dye Slip (Round ${showRound})` : showRound === 'all' ? 'All Rounds Report' : data.isPcJob ? 'PC DYEING SLIP' : 'DYEING SLIP'
    html += `<div class="center" style="margin:2px 0">${subtitle}</div>`
    if (data.isReDyed && !showingSpecific && showRound !== 'all') {
      html += `<div class="center bold" style="color:red">RE-DYED (${data.totalRounds} rounds)</div>`
    }
    html += `<div class="divider2"></div>`

    // Info grid
    html += `<div class="row"><span>Slip: <b>${data.slipNo}</b></span><span>Date: <b>${data.date}</b></span></div>`
    if (data.partyName) html += `<div>Party: <b>${data.partyName}</b></div>`
    if (data.qualityName) html += `<div>Quality: <b>${data.qualityName}</b></div>`
    if (data.marka) html += `<div>Marka: <b>${data.marka}</b></div>`
    if (data.shadeName) html += `<div>Shade: <b>${data.shadeName}</b>${data.shadeDescription ? ` &mdash; ${data.shadeDescription}` : ''}</div>`
    if (machine || operator) {
      html += `<div class="row">`
      if (machine) html += `<span>M: ${machine}</span>`
      if (operator) html += `<span>Op: ${operator}</span>`
      html += `</div>`
    }
    if (showingSpecific && specificAdd?.defectType) {
      html += `<div style="color:red">Defect: <b>${specificAdd.defectType}</b></div>`
      if (specificAdd.reason) html += `<div>Reason: ${specificAdd.reason}</div>`
    }

    html += `<div class="divider"></div>`

    // Lots
    html += `<div class="lot" style="margin-top:3px">LOTS:</div>`
    for (const l of data.lots) {
      html += `<div class="row lot"><span>${l.lotNo}</span><span>${l.than} than</span></div>`
    }
    if (data.lots.length > 1) {
      html += `<div class="row lot"><span>Total:</span><span>${data.totalThan} than</span></div>`
    }
    html += `<div class="divider"></div>`

    // Chemicals — dyes in grams (4-digit), auxiliary in kg
    const chemTable = (chems: { name: string; quantity: number | null; unit: string }[], isDye: boolean) => {
      let t = `<table class="chem">`
      chems.forEach((c, i) => {
        let qty = '-'
        let unit = c.unit
        if (c.quantity != null) {
          if (isDye) {
            const grams = Math.round(c.quantity * 1000)
            qty = String(grams).padStart(4, '0')
            unit = 'gm'
          } else {
            qty = c.quantity.toFixed(1)
            unit = 'kg'
          }
        }
        t += `<tr><td class="td-num">${i + 1}</td><td class="td-name">${c.name}</td><td class="td-qty">${qty}</td><td class="td-unit">${unit}</td></tr>`
      })
      t += `</table>`
      return t
    }

    if (showRound === 1 || showRound === 'all') {
      if (showRound === 'all') html += `<div class="section">ROUND 1 (Original)</div>`
      for (const tag of tagOrder) {
        const isDye = tag === 'shade'
        const label = isDye ? 'DYES (grams)' : tag === 'Other' ? 'OTHER (kg)' : tag.toUpperCase() + ' (kg)'
        html += `<div class="section">${label}</div>`
        html += chemTable(grouped[tag], isDye)
      }
    }

    if (showingSpecific && specificAdd) {
      html += `<div class="section">RE-DYE (Round ${showRound})</div>`
      html += chemTable(specificAdd.chemicals, true)
    }

    if (showRound === 'all') {
      for (const a of data.additions) {
        const label = a.type === 're-dye' ? 'Re-Dye' : 'Addition'
        html += `<div class="section">ROUND ${a.roundNo} (${label})${a.defectType ? ` - ${a.defectType}` : ''}</div>`
        if (a.reason) html += `<div style="font-size:10px">Reason: ${a.reason}</div>`
        html += chemTable(a.chemicals, false)
      }
    }

    html += `<div class="divider2"></div>`
    html += `<div class="sign"><div class="sign-line">Operator</div></div>`
    html += `<div class="sign"><div class="sign-line">Supervisor</div></div>`
    html += `<div style="height:10mm"></div>`

    html += `<script>setTimeout(function(){window.print();},300);</script>`
    html += `</body></html>`

    // Open in new window — Android print dialog shows Bluetooth printers
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
    }

    setTimeout(() => setPrinting(false), 2000)
  }

  return (
    <button
      onClick={printReceipt}
      disabled={printing}
      className="bg-orange-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-60 flex items-center gap-2"
    >
      <span>🧾</span>
      <span>{printing ? 'Opening...' : 'Receipt Print'}</span>
    </button>
  )
}
