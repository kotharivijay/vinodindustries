# CLAUDE.md — Project Guide for Claude Code

> Always loaded by Claude Code at session start. Keep short and current.
> Detailed spec lives in `PRD.md`.

## Project

KSI Inward & Purchase Management module — replaces the legacy
`/inventory` sub-section of this repo. Single-firm (Kothari Synthetic
Industries) for now; the same module structure will later be cloned
for Vinod Industries (VI) as a sibling.

Lives inside the existing Vinod Industries Next.js app under
`/inventory/*` routes. Shares Prisma DB, NextAuth, Google Drive helpers,
WhatsApp (ChatMitra), and Tally tunnel configuration with the rest of
the app.

## Always Read First

- `PRD.md` — full spec (locked decisions in §0)
- `prisma/schema.prisma` — current DB shape
- This file

## Critical Rules

1. **Challan never pushes to Tally.** Only Purchase Invoice does, as a
   Purchase voucher (JSON, `jsonex` format).
2. **One challan → at most one purchase_invoice.** Block UI/API attempts
   otherwise.
3. **GST treatment auto-decided** (never ask the user):
   - Party `Unregistered` or `Composition` → `NONE` (no GST ledgers)
   - Party `Regular` + same state as KSI → `CGST_SGST`
   - Party `Regular` + different state → `IGST`
4. **Two-layer items:**
   - `tally_alias_items` syncs from Tally (small list — `Dye 18%`,
     `XNI`, `Machinery Parts 18%`…)
   - `items` is app-native (large catalog) with mandatory `aliasId` FK
   - Tally voucher: `stockitemname` = alias name,
     `basicuserdescription` = real item name (or invoice-line override)
5. **Stock movements** only for items with `trackStock=true`
   (chemicals/dyes).
6. **Single Tally tunnel** — env `TALLY_TUNNEL_URL`; KSI is the only
   firm so `svCurrentCompany` is hardcoded in payload.
7. **Photos = Google Drive only.** Folder pattern in PRD §8.
8. **Pending-review items** block invoice push to Tally. Pre-push
   validation surfaces this.
9. **Internal series** assigned at Draft creation; immutable;
   cancellation is soft (status='Cancelled', series retained).
10. **Series counter** uses transactional `UPDATE … RETURNING` on
    `series_counters`. Never use bare auto-increment for user-facing
    series.
11. **Audit everything.** Append to `audit_log` on every
    create/update/verify/push/void.
12. **RCM is Phase 2.** Don't add toggles or fields for it now.

## Tally JSON Push — Key Specifics

Port the proven helpers from `app/api/tally/*` (already in-repo for
sales vouchers):

- `fmtDate(input)` — multi-format → `YYYYMMDD`
- `neg(n)` — sign convention helper
- Round-off computation pattern
- Headers: `Content-Type / version / tallyrequest / type / id`
  + optional CF-Access
- Defensive JSON response parser (Tally Prime returns malformed JSON
  for `vchnumber`)

Extensions over the existing sales path:

- Multi-line `allinventoryentries` (loop over invoice lines)
- `stockitemname` = alias, `basicuserdescription` = real item name
- Dynamic GST rate per line from `tally_alias_items.gstRate`;
  `ratedetails` half/half/full
- Voucher-level discount aggregation (sum of line `discountAmount` →
  `Discount (GST)` Cr)
- Unregistered party path: skip GST ledger entries;
  `gstovrdntaxability: "Exempt"`; `ratedetails` all "Not Applicable"

## Code Conventions

- TypeScript strict mode
- Prisma ORM (already in-repo); Drizzle is **not** added
- Server actions / route handlers; SWR on the client
- Money in `Numeric(16,2)` in DB, `string` decimal over the wire,
  `Decimal.js` for math. **Never use JS `number` for money.**
- Dates as `YYYY-MM-DD` strings on the wire; `Date` only inside server
  logic; `YYYYMMDD` only at Tally push boundary
- Indian comma formatting in UI (`Intl.NumberFormat('en-IN')`)
- Reuse existing repo helpers: `lib/tally/*`, `lib/drive`, `lib/whatsapp`

## Performance Targets

- Party type-ahead: <200ms
- Item Tier-A list: <200ms
- Last-3-rates: <200ms
- Challan save: <800ms incl. Drive metadata write
- Tally Purchase voucher push: <3s typical, retry on timeout

## Build Order (current)

See PRD §14. Update this line as we progress:
**Currently at: Step 1 — Prisma schema + migration.**

1. Prisma schema for new inventory module + drop old PO/DC tables
2. Master sync from Tally: parties + alias items
3. Real-items catalog (manual + CSV)
4. Item Review Queue (manager workflow)
5. Party + Item picker components (Tier A/B/C)
6. Series counter atomic allocator
7. Inward Challan create / list / edit + Drive uploads
8. Stock IN movements on challan verify
9. Purchase Order module + WhatsApp share
10. Discount system (per-line + header default)
11. Purchase Invoice module + GST treatment + multi-challan select
12. Pre-push validation engine + Tally JSON push
13. Daily reports + WhatsApp digests + Series Gap Report

## Out of Bounds

- No multi-firm switching (KSI only; VI will be a sibling later)
- No Receipt Note vouchers in Tally
- No PO sync from Tally (POs are app-native)
- No XML push path — JSON only (Tally Prime 7)
- No SMS or email — WhatsApp only
- No GST return filing — only reconciliation (Phase 2)

## When Unsure

1. Re-read PRD §0 (locked decisions)
2. Search `lib/tally/`, `lib/series/`, `lib/drive/` for similar patterns
3. Reference existing `app/api/tally-*` routes — port faithfully
4. Ask Vijay one focused question. Don't guess on Tally JSON structure
   or GST ledger names — ask.
