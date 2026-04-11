---
name: Ideas and pending work tracker
description: Running list of ideas, pending features, and execution checklist across KSI and VI modules
type: project
---

## KSI (Kothari Synthetic Industries) — Pending

### Finish/Center Module
- [x] Finish Stock tab (dyeing-done slips as finish stock)
- [x] Party View (3-level: Party → Quality → Lot)
- [x] Shade description in lot expansion
- [ ] "Start Finish Entry" pre-fills from dyeing slip data
- [ ] Draft queue / cloud save (like dyeing module)
- [ ] Print/receipt generation
- [ ] Machine & operator assignment
- [ ] Status workflow (pending → in-progress → done)
- [ ] Quality photos

### Dyeing Module
- [x] Batch-based entry from Fold
- [x] Status workflow (pending/patchy/re-dyeing/done)
- [x] Machine & operator assignment
- [ ] Bluetooth thermal label printing (code exists, needs testing)

### Grey Register
- [x] Carry-forward opening balance from last year
- [x] Import from Google Sheet (skip "old year")
- [ ] Auto-sync with sheet on schedule

### Stock
- [x] Balance stock page with party-wise breakdown
- [x] Opening balance integration
- [ ] QR code on bales

### General
- [ ] Role-based access (admin/viewer)
- [ ] Audit log (who changed what)
- [ ] Daily DB backup to Google Drive
- [ ] Production pipeline visual (Grey → Fold → Dyeing → Finish → Despatch)

---

## VI (Vinod Industries) — Pending

### Tally Integration
- [x] Ledger Master sync (SSE, 9000+ ledgers)
- [x] Outstanding sync (bill-wise)
- [x] Sales sync (weekly chunked, resume on error)
- [x] Receipt/Payment sync
- [x] Tally Dashboard
- [x] Party 360° View (DB only, no live Tally)
- [x] Party Performance (score, trends)
- [ ] Purchase Register sync

### Orders
- [x] Sync from 3 Google Sheets (VI/VCF/VF Order)
- [x] Expandable order cards (rate visible)
- [x] Clickable party name → detail popup (4 tabs)
- [x] Clickable agent name → agent OS popup
- [x] Party OS inline panel (bills + checkboxes + WA share)
- [x] Agent OS inline panel (party accordion + bill-wise)
- [x] JPG image share (Canvas, Web Share API)
- [ ] Agent dropdown filter on orders (not just OS)

### Outstanding
- [x] Multi-page JPG image share (15 bills/page)
- [x] Sort before share (due days, invoice, amount)
- [x] WhatsApp text share with contact number
- [x] Option C: text first → then images
- [ ] Agent tab view (group by agent parent ledger)
- [ ] Export per-party OS as PDF

### Contacts
- [x] Sync from vi pa / vcf pa sheets
- [x] Merged with TallyLedger data
- [ ] Bulk WhatsApp broadcast
- [ ] Contact deduplication tool

### Call Reminders
- [x] Priority scoring (same as GAS)
- [x] Call logging with promise/follow-up
- [x] Call history per party
- [ ] OS Snapshot (weekly trend badge)
- [ ] Agent filter in call reminders
- [ ] Auto email daily digest of urgent calls

### Bank Payments
- [x] Sync from vi_bank + bank sheets
- [x] VF from Tally receipts
- [ ] Payment behavior tags in party cards
- [ ] Bank reconciliation view

### Security
- [x] Cloudflare Tunnel (permanent domain: tally.vinodindustries.co.in)
- [x] CF Access service token
- [x] API key protection
- [ ] Cloudflare Access policy enforcement

---

## Cross-Module Ideas

| # | Idea | Module | Priority |
|---|------|--------|----------|
| 1 | Daily Business Report (auto email 8 AM) | VI | High |
| 2 | Sales Comparison (this month vs last) | VI | Medium |
| 3 | Rate Card (party-wise last rates) | VI | Medium |
| 4 | GST Report (GSTR-1 from sales) | VI | Medium |
| 5 | Cash Flow Forecast | VI | Low |
| 6 | WhatsApp Business API integration | VI | Future |
| 7 | Lot Cost Sheet (grey + dyeing + finish + transport) | KSI | High |
| 8 | Weaver Performance tracking | KSI | Medium |
| 9 | Transport Tracker (LR status) | KSI | Medium |
| 10 | Multi-user roles | Both | Medium |

---

## Technical Debt
- [ ] KSI build errors: ai-chat `tag` field, bluetooth types (fix on PC)
- [ ] Remove `experimental.serverActions` from next.config.js
- [x] HTML entity decoding in Tally ledger names
- [x] Mobile number parsing during sync (not separate backfill)
- [ ] Upgrade Next.js 14 → 15
- [ ] Upgrade Prisma 5 → 7
