# Inward, PO, Purchase Invoice & Inventory Module — PRD

> **Owner:** Vijay (KSI · Balotara, Rajasthan)
> **Status:** Locked design. Single-firm (KSI) implementation.
> **Companion:** `CLAUDE.md` (auto-loaded by Claude Code).

---

## 0. Locked Decisions

| # | Decision |
|---|----------|
| 1  | POs created inside this module — full CRUD + WhatsApp share to supplier |
| 2  | No Receipt Note in Tally. Only **Purchase voucher** when supplier invoice arrives |
| 3  | Single firm: **Kothari Synthetic Industries**. VI module will be a separate sibling later |
| 4  | Stock tracked only for **chemicals + dyes** (`items.trackStock = true`) |
| 5  | **Single Cloudflare Tunnel** (existing repo's `TALLY_TUNNEL_URL`); `svCurrentCompany` = KSI Tally company name |
| 6  | Google Drive for file storage with structured folders |
| 7  | **Two-layer items:** small Tally alias list + rich app-native real-item catalog mapped to aliases |
| 8  | **Tally push uses native JSON** (`jsonex`), not XML — port from existing `app/api/tally-*` |
| 9  | Tally voucher line → `stockitemname` = alias, `basicuserdescription` = real item name (editable per invoice line) |
| 10 | Operator can create new real items inline → `pending_review`. Usable immediately. **Invoice push blocked** until manager approves |
| 11 | Per-line discount **+ header default discount with line override** |
| 12 | Challan `rate` nullable — material can arrive before invoice; rates filled later |
| 13 | Per-category → ledger map + per-category → godown map (with optional per-alias godown override) |
| 14 | GST ledgers keyed by leg × rate (`{IGST:{18:"Input IGST 18%"}, CGST:{...}, SGST:{...}}`), single config row |
| 15 | **Unregistered / Composition parties** — push without GST ledger entries; inventory marked `Exempt`; `gstregistrationtype` mirrors party |
| 16 | RCM (Reverse Charge) — **deferred to Phase 2** |
| 17 | **Internal sequential series** for every inward challan: `IN/26-27/0023` — gap-free governance |
| 18 | `itemGroup` taxonomy is global within KSI |
| 19 | Challan can be saved/verified without rates; invoice push blocks until rates filled |
| 20 | **No data migration** from legacy `/inventory` tables; old PO / DeliveryChallan rows are dropped |

---

## 1. Mental Models

### 1.1 The Two-Document Flow

```
PO ───▶ Inward Challan ───▶ Purchase Invoice ───▶ Tally Purchase Voucher (JSON)
       (stock IN for          (1..N challans)     (alias as stockitemname +
        chemicals/dyes)                            real name as description)
```

- **Challan** never pushes to Tally. Books stock + photos.
- **Purchase Invoice** links 1..N challans, pushed to Tally as Purchase
  voucher (JSON).
- A challan can link to **at most one** invoice. An invoice can link to
  **N** challans.

### 1.2 The Two-Layer Item Model

```
LAYER 1 (app-native, large)        LAYER 2 (Tally-synced, small)
"Reactive Yellow 145"   ──┐
"Reactive Red 195"      ──┼── "Dye 18%"               → Tally master
"Reactive Blue 222"     ──┘

"Sandozin EH-DC"        ──┐
"Caustic Soda Flakes"   ──┼── "XNI"                   → Tally master
"Wetting Agent W-100"   ──┘

"Drive Belt M4-A1"      ──┐
"Bearing 6205-2RS"      ──┼── "Machinery Parts 18%"   → Tally master
```

Rules:

- Real item → exactly 1 alias (mandatory FK).
- Alias → many real items.
- Tally pull syncs aliases + parties only. Real items are app-native.
- Push: `stockitemname` = alias, `basicuserdescription` = real item
  name (editable per invoice line).
- Real item unit MUST match alias unit; GST rate MUST match alias rate.
  HSN may override per real item.
- Alias mapping change blocked once item used in any pushed invoice.

### 1.3 Three-Tier Item Picker Ranking

```
Tier A: items received from THIS party in last 90 days
Tier B: items in same itemGroup as Tier A items, never bought from this party
Tier C: full catalog (fuzzy on display_name)
```

Default = Tier A. "Show all" expands to A+B+C.

---

## 2. Workflows

### 2.1 PO Creation

1. "+ New PO" from `/inventory/po`
2. Party search (recent 5 first)
3. PO No auto-generated `KSI/PO/<FY-short>/<seq>` (editable)
4. Date (today), Expected Delivery
5. Add lines: item picker (Tier A/B/C), qty, unit, rate
   (last-3-rates inline)
6. Header default discount (%) + per-line override
7. Save Draft → Approve → Generate PDF → WhatsApp share to
   `parties.whatsapp` via ChatMitra
8. Status: `Draft / Approved / Open / Partial / Closed / Cancelled`

### 2.2 Inward Challan Entry

1. From `/inventory/challan/new`
2. Select Party (Tier A first)
3. Optional: Link to Open/Partial PO of this party (lines pre-fill)
4. Header: Challan No (mandatory; duplicate check ±3 days),
   Challan Date (default today), Bilty/LR No, Vehicle No, Transporter,
   Photos to Drive
5. Add lines via picker. Per-line: qty, unit, rate (nullable),
   discount pill (auto from header default)
6. **At first save:** internal series number assigned atomically
7. On Verify: stock IN movements created for `trackStock=true` items
8. Status:
   `Draft / Verified / PendingApproval / PendingInvoice / Invoiced / Cancelled`

### 2.3 Inline Real-Item Creation

1. Operator searches item, no match
2. "+ Create item: <typed name>"
3. Quick form: displayName, group, **alias** (mandatory, drives unit /
   GST / HSN), trackStock auto from alias category
4. Save → `items.reviewStatus = 'pending_review'`, immediately usable
5. Manager Review Queue at `/inventory/items/review`
6. **Pending-review items block invoice push** (pre-push validation)
7. Daily WhatsApp digest at 10am: pending-review count

### 2.4 Purchase Invoice Creation

1. "+ New Invoice" → select Party
2. App lists all PendingInvoice challans of this party (last 90 days,
   multi-select)
3. Selected challans' lines populate invoice with editable per-line
   `description`
4. User can edit qty/rate, add lines (freight), remove lines (partial
   billing)
5. Header: Supplier Inv No (mandatory), Inv Date, GST treatment
   (auto from party + state)
6. Status: `Draft / Verified / PushPending / PushedToTally / Voided`
7. **Pre-push validation** — see §6.4
8. Push → build JSON payload → POST to single tunnel → store voucher
   GUID + number → flip linked challans to `Invoiced`
9. On failure: status PushPending; worker retries every 5 min, max 12
   attempts, then alert

### 2.5 Challan ↔ Invoice Linking Rules

- A challan links to **at most 1** purchase_invoice.
- An invoice links to **N** challans.
- Each invoice line points to **0..1** challan_line (NULL for freight).
- Editing a challan locked once invoiced. Voiding the invoice frees
  challans back to `PendingInvoice`.

---

## 3. DB Schema (Prisma)

```prisma
// ── Masters ────────────────────────────────────────────────────────

model Party {
  id                  Int      @id @default(autoincrement())
  tallyLedger         String   @unique
  tallyGuid           String?
  displayName         String
  gstin               String?
  state               String?
  city                String?
  whatsapp            String?
  email               String?
  parentGroup         String?
  // 'Regular' | 'Composition' | 'Unregistered'
  gstRegistrationType String   @default("Regular")
  active              Boolean  @default(true)
  lastSyncedAt        DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  challans            InvChallan[]
  pos                 InvPO[]
  invoices            InvPurchaseInvoice[]

  @@index([displayName])
  @@index([gstin])
}

model InvItemGroup {
  id       Int    @id @default(autoincrement())
  name     String @unique
  category String              // 'Chemical' | 'Dye' | 'Auxiliary' | 'Spare'

  items    InvItem[]
}

// LAYER 2 — Tally alias items (small, synced from Tally)
model InvTallyAlias {
  id                Int      @id @default(autoincrement())
  tallyStockItem    String   @unique           // 'Dye 18%','XNI','Machinery Parts 18%'
  tallyGuid         String?
  displayName       String
  category          String                      // drives ledger/godown lookup
  hsn               String?
  gstRate           Decimal  @db.Decimal(5,2)
  unit              String
  defaultTrackStock Boolean  @default(false)
  godownOverride    String?                     // overrides category default
  active            Boolean  @default(true)
  lastSyncedAt      DateTime?

  items             InvItem[]
}

// LAYER 1 — Real items (app-native, large catalog)
model InvItem {
  id              Int      @id @default(autoincrement())
  displayName     String   @unique
  aliasId         Int
  alias           InvTallyAlias @relation(fields: [aliasId], references: [id])
  groupId         Int?
  group           InvItemGroup? @relation(fields: [groupId], references: [id])
  unit            String                           // must match alias.unit
  hsnOverride     String?
  gstOverride     Decimal? @db.Decimal(5,2)
  trackStock      Boolean
  // 'approved' | 'pending_review' | 'rejected'
  reviewStatus    String   @default("approved")
  createdById     Int?
  reviewedById    Int?
  reviewedAt      DateTime?
  rejectionReason String?
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  poLines         InvPOLine[]
  challanLines    InvChallanLine[]
  invoiceLines    InvPurchaseInvoiceLine[]
  stockMovements  InvStockMovement[]

  @@index([displayName])
  @@index([reviewStatus])
}

// ── Series Counter (gap-free numbering) ────────────────────────────

model InvSeriesCounter {
  seriesType String                  // 'inward' (Phase 2: 'po','invoice')
  fy         String                  // '2026-27'
  lastNo     Int     @default(0)
  updatedAt  DateTime @default(now()) @updatedAt
  @@id([seriesType, fy])
}

// ── Purchase Order ─────────────────────────────────────────────────

model InvPO {
  id                  Int      @id @default(autoincrement())
  partyId             Int
  party               Party    @relation(fields: [partyId], references: [id])
  poNo                String   @unique
  poDate              DateTime
  expectedDate        DateTime?
  // 'Draft' | 'Approved' | 'Open' | 'Partial' | 'Closed' | 'Cancelled'
  status              String   @default("Draft")
  totalAmount         Decimal? @db.Decimal(16,2)
  defaultDiscountPct  Decimal? @db.Decimal(6,3)
  terms               String?
  notes               String?
  pdfDriveUrl         String?
  whatsappSentAt      DateTime?
  approvedById        Int?
  approvedAt          DateTime?
  createdById         Int?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  lines               InvPOLine[]
  challans            InvChallan[]

  @@index([partyId, poDate])
  @@index([status])
}

model InvPOLine {
  id              Int      @id @default(autoincrement())
  poId            Int
  po              InvPO    @relation(fields: [poId], references: [id], onDelete: Cascade)
  lineNo          Int
  itemId          Int
  item            InvItem  @relation(fields: [itemId], references: [id])
  qty             Decimal  @db.Decimal(14,3)
  unit            String
  rate            Decimal  @db.Decimal(14,4)
  amount          Decimal  @db.Decimal(16,2)
  receivedQty     Decimal  @default(0) @db.Decimal(14,3)
  discountType    String?                              // 'PCT' | 'AMT'
  discountValue   Decimal? @db.Decimal(10,4)
  discountAmount  Decimal? @db.Decimal(14,2)
  remarks         String?

  challanLines    InvChallanLine[]
}

// ── Inward Challan ─────────────────────────────────────────────────

model InvChallan {
  id                       Int      @id @default(autoincrement())
  partyId                  Int
  party                    Party    @relation(fields: [partyId], references: [id])
  poId                     Int?
  po                       InvPO?   @relation(fields: [poId], references: [id])
  // Internal sequential series (gap-free)
  internalSeriesNo         Int
  seriesFy                 String                       // '2026-27'
  // Supplier's challan number
  challanNo                String
  challanDate              DateTime
  biltyNo                  String?
  vehicleNo                String?
  transporter              String?
  defaultDiscountPct       Decimal? @db.Decimal(6,3)
  totalQty                 Decimal? @db.Decimal(14,3)
  totalAmount              Decimal? @db.Decimal(16,2)
  // 'Draft' | 'Verified' | 'PendingApproval' | 'PendingInvoice' | 'Invoiced' | 'Cancelled'
  status                   String   @default("Draft")
  varianceFlag             Boolean  @default(false)
  hasPendingReviewItems    Boolean  @default(false)
  hasRatelessLines         Boolean  @default(false)
  driveFolderUrl           String?
  notes                    String?
  cancelledReason          String?
  createdById              Int?
  verifiedById             Int?
  cancelledById            Int?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  lines                    InvChallanLine[]
  attachments              InvChallanAttachment[]
  invoiceLink              InvInvoiceChallan?

  @@unique([partyId, challanNo])
  @@unique([seriesFy, internalSeriesNo])
  @@index([challanDate])
  @@index([status])
}

model InvChallanLine {
  id              Int      @id @default(autoincrement())
  challanId       Int
  challan         InvChallan @relation(fields: [challanId], references: [id], onDelete: Cascade)
  lineNo          Int
  itemId          Int
  item            InvItem  @relation(fields: [itemId], references: [id])
  poLineId        Int?
  poLine          InvPOLine? @relation(fields: [poLineId], references: [id])
  qty             Decimal  @db.Decimal(14,3)
  unit            String
  rate            Decimal? @db.Decimal(14,4)            // nullable: rate-later
  discountType    String?
  discountValue   Decimal? @db.Decimal(10,4)
  discountAmount  Decimal? @db.Decimal(14,2)
  grossAmount     Decimal? @db.Decimal(16,2)
  amount          Decimal? @db.Decimal(16,2)
  damageQty       Decimal  @default(0) @db.Decimal(14,3)
  damageRemarks   String?
  rateVariancePct Decimal? @db.Decimal(6,2)
  varianceReason  String?

  invoiceLines    InvPurchaseInvoiceLine[]
}

model InvChallanAttachment {
  id            Int      @id @default(autoincrement())
  challanId     Int
  challan       InvChallan @relation(fields: [challanId], references: [id], onDelete: Cascade)
  kind          String                                // 'challan_photo' | 'lr' | 'weighing'
  driveFileId   String
  driveViewUrl  String
  filename      String?
  uploadedById  Int?
  uploadedAt    DateTime @default(now())
}

// ── Purchase Invoice ───────────────────────────────────────────────

model InvPurchaseInvoice {
  id                       Int      @id @default(autoincrement())
  partyId                  Int
  party                    Party    @relation(fields: [partyId], references: [id])
  supplierInvoiceNo        String
  supplierInvoiceDate      DateTime
  // 'IGST' | 'CGST_SGST' | 'NONE'
  gstTreatment             String
  defaultDiscountPct       Decimal? @db.Decimal(6,3)
  taxableAmount            Decimal  @db.Decimal(16,2)
  igstAmount               Decimal  @default(0) @db.Decimal(14,2)
  cgstAmount               Decimal  @default(0) @db.Decimal(14,2)
  sgstAmount               Decimal  @default(0) @db.Decimal(14,2)
  freightAmount            Decimal  @default(0) @db.Decimal(14,2)
  totalDiscountAmount      Decimal  @default(0) @db.Decimal(14,2)
  otherCharges             Decimal  @default(0) @db.Decimal(14,2)
  roundOff                 Decimal  @default(0) @db.Decimal(8,2)
  totalAmount              Decimal  @db.Decimal(16,2)
  // 'Draft' | 'Verified' | 'PushPending' | 'PushedToTally' | 'Voided'
  status                   String   @default("Draft")
  hasPendingReviewItems    Boolean  @default(false)
  tallyVoucherNo           String?
  tallyVoucherGuid         String?
  tallyPushedAt            DateTime?
  tallyPayload             Json?
  tallyResponse            Json?
  pushAttempts             Int      @default(0)
  lastPushError            String?
  notes                    String?
  driveFolderUrl           String?
  createdById              Int?
  verifiedById             Int?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  lines                    InvPurchaseInvoiceLine[]
  challans                 InvInvoiceChallan[]

  @@unique([partyId, supplierInvoiceNo])
  @@index([supplierInvoiceDate])
  @@index([status])
}

model InvPurchaseInvoiceLine {
  id              Int      @id @default(autoincrement())
  invoiceId       Int
  invoice         InvPurchaseInvoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  lineNo          Int
  itemId          Int?
  item            InvItem? @relation(fields: [itemId], references: [id])
  challanLineId   Int?
  challanLine     InvChallanLine? @relation(fields: [challanLineId], references: [id])
  description     String?                                 // → BASICUSERDESCRIPTION
  freeTextLabel   String?
  qty             Decimal? @db.Decimal(14,3)
  unit            String?
  rate            Decimal? @db.Decimal(14,4)
  discountType    String?
  discountValue   Decimal? @db.Decimal(10,4)
  discountAmount  Decimal? @db.Decimal(14,2)
  grossAmount     Decimal? @db.Decimal(16,2)
  amount          Decimal  @db.Decimal(16,2)              // net (post-discount)
  gstRate         Decimal? @db.Decimal(5,2)
  gstAmount       Decimal? @db.Decimal(14,2)
  total           Decimal? @db.Decimal(16,2)
}

model InvInvoiceChallan {
  invoiceId   Int
  invoice     InvPurchaseInvoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  challanId   Int                @unique          // each challan in at most one invoice
  challan     InvChallan         @relation(fields: [challanId], references: [id])
  @@id([invoiceId, challanId])
}

// ── Stock (chemicals/dyes only) ────────────────────────────────────

model InvStockMovement {
  id            Int      @id @default(autoincrement())
  itemId        Int
  item          InvItem  @relation(fields: [itemId], references: [id])
  movementDate  DateTime
  // 'IN' | 'OUT'
  direction     String
  qty           Decimal  @db.Decimal(14,3)
  unit          String?
  // 'CHALLAN' | 'CONSUMPTION' | 'ADJUST'
  refType       String?
  refId         Int?
  remarks       String?
  createdAt     DateTime @default(now())

  @@index([itemId, movementDate])
}

// ── Tally Push Config (single row for KSI) ─────────────────────────

model InvTallyConfig {
  id                  Int      @id @default(1)
  // Category → ledger map
  // {"Chemical":"Chemical Purchase","Dye":"Dye Purchase","Auxiliary":"Auxiliary Purchase","Spare":"Machinery Spare Purchase"}
  purchaseLedgerMap   Json
  // Category → godown
  godownMap           Json
  // GST ledgers by leg × rate
  gstLedgers          Json
  roundOffLedger      String   @default("Round Off")
  freightLedger       String   @default("Freight Inward (GST)")
  discountLedger      String   @default("Discount (GST)")
  updatedAt           DateTime @default(now()) @updatedAt
}

// ── Audit Log (cross-cutting) ──────────────────────────────────────

model InvAuditLog {
  id          Int      @id @default(autoincrement())
  userId      Int?
  action      String
  entityType  String?
  entityId    Int?
  payload     Json?
  createdAt   DateTime @default(now())

  @@index([entityType, entityId])
}
```

> All new models use the `Inv*` prefix to avoid collisions with the
> existing repo schema (e.g. `Party` is already taken — see §3.1).

### 3.1 Naming Note: existing `Party` collision

The repo's existing `Party` model is for grey/dyeing operations. For
inventory we'll either (a) extend that model with the new fields
(`gstin`, `gstRegistrationType` etc.) and reuse, or (b) use a separate
`InvParty` model. **Decision:** extend the existing `Party` so the
party master is shared across modules (reduces duplication; chemical
suppliers may also be referenced elsewhere). The Tally-specific fields
are added as additional columns.

---

## 4. API Endpoints (REST)

```
# Masters
GET    /api/inv/parties?q=
POST   /api/inv/parties/sync                    # full sync from Tally
GET    /api/inv/aliases?q=
POST   /api/inv/aliases/sync
GET    /api/inv/items?q=&reviewStatus=
POST   /api/inv/items                           # creates pending_review for operator
PATCH  /api/inv/items/:id
POST   /api/inv/items/:id/approve
POST   /api/inv/items/:id/reject
POST   /api/inv/items/import-csv
GET    /api/inv/items/by-party?partyId=&days=90
GET    /api/inv/items/review-queue
GET    /api/inv/items/:id/recent-rates?partyId=&n=3
GET    /api/inv/tally-config
PATCH  /api/inv/tally-config

# Series
GET    /api/inv/series/next?type=inward         # peek next number
GET    /api/inv/series/gaps?type=inward&fy=

# POs
GET    /api/inv/pos?status=&partyId=&q=
GET    /api/inv/pos/:id
POST   /api/inv/pos
PATCH  /api/inv/pos/:id
POST   /api/inv/pos/:id/approve
POST   /api/inv/pos/:id/cancel
GET    /api/inv/pos/:id/pdf
POST   /api/inv/pos/:id/whatsapp

# Challans
POST   /api/inv/challans                        # creates Draft + assigns series
GET    /api/inv/challans?from=&to=&status=&partyId=&q=
GET    /api/inv/challans/:id
PATCH  /api/inv/challans/:id
POST   /api/inv/challans/:id/verify
POST   /api/inv/challans/:id/cancel
POST   /api/inv/challans/check-duplicate        # body: {partyId, challanNo, date}
POST   /api/inv/challans/upload-attachment      # multipart → Drive

# Purchase Invoices
POST   /api/inv/invoices
GET    /api/inv/invoices?from=&to=&status=&partyId=
GET    /api/inv/invoices/:id
PATCH  /api/inv/invoices/:id
POST   /api/inv/invoices/:id/verify
POST   /api/inv/invoices/:id/push-to-tally
GET    /api/inv/invoices/:id/preview-payload    # dry-run JSON
POST   /api/inv/invoices/:id/void

# Stock
GET    /api/inv/stock/by-real-item
GET    /api/inv/stock/by-alias
GET    /api/inv/stock/ledger?itemId=&from=&to=

# Reports
GET    /api/inv/reports/daily-inward.pdf?date=
GET    /api/inv/reports/series-gaps.pdf?fy=
GET    /api/inv/reports/open-pos.pdf
GET    /api/inv/reports/pending-invoice-challans.pdf
POST   /api/inv/reports/whatsapp-share
```

---

## 5. UI Routes (under `/inventory/*`)

```
/inventory                          → redirects to /inventory/challans
/inventory/challans                 list (with filter chips, search)
/inventory/challans/new             entry form
/inventory/challans/[id]            view + edit
/inventory/challans/series-gaps     governance report

/inventory/po                       list
/inventory/po/new                   create
/inventory/po/[id]                  view + edit + WhatsApp

/inventory/invoices                 list
/inventory/invoices/new             multi-challan select + line edit
/inventory/invoices/[id]            view + push to Tally

/inventory/items                    catalog list (Tier filters)
/inventory/items/new                manual create
/inventory/items/import             CSV upload
/inventory/items/review             manager review queue

/inventory/aliases                  Tally alias list (read-only after sync)
/inventory/parties                  party master (read-only after sync, edit GST type / WhatsApp)

/inventory/stock                    real-item & alias-bucket views
/inventory/config                   Tally config (ledgers, godowns)
/inventory/reports                  daily / series-gaps / open POs
```

---

## 6. Tally JSON Push (Native `jsonex`)

### 6.1 Architecture

- Single Cloudflare Tunnel from env `TALLY_TUNNEL_URL`
- POST as `application/json` with required headers
- Defensive JSON response parser (Tally Prime returns slightly malformed
  JSON for `vchnumber`)
- Full payload + response stored in `InvPurchaseInvoice.tallyPayload` /
  `.tallyResponse` for audit
- Retry worker: every 5 min, max 12 attempts on PushPending status

### 6.2 Helpers (port from existing `app/api/tally-*`)

```ts
function fmtDate(input: string): string {
  // Accept 'DD-MM-YY','DD-MM-YYYY','YYYY-MM-DD' → 'YYYYMMDD'
  const s = input.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '')
  const m = s.match(/^(\d{2})-(\d{2})-(\d{2,4})$/)
  if (m) {
    const dd = m[1], mm = m[2]
    const yy = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${yy}${mm}${dd}`
  }
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function neg(n: number): string { return `-${n.toFixed(2)}` }
```

### 6.3 Voucher Skeleton (single firm = KSI)

```ts
async function buildPurchaseVoucherJSON(invoice, party, cfg, lines /* with item+alias */) {
  const isUnreg = ['Unregistered', 'Composition'].includes(party.gstRegistrationType)
  const KSI_STATE = process.env.KSI_STATE || 'Rajasthan'
  const KSI_TALLY = process.env.KSI_TALLY_COMPANY || 'Kothari Synthetic Industries'
  const isIntra  = !isUnreg && party.state?.toLowerCase() === KSI_STATE.toLowerCase()

  const allinventoryentries = lines.map(l => {
    const godown        = l.alias.godownOverride ?? cfg.godownMap[l.alias.category]
    const purchaseLedger = cfg.purchaseLedgerMap[l.alias.category]
    if (!godown)         throw new Error(`No godown for category ${l.alias.category}`)
    if (!purchaseLedger) throw new Error(`No purchase ledger for category ${l.alias.category}`)

    const rate = Number(l.alias.gstRate)
    const half = (rate / 2).toFixed(2)

    return {
      stockitemname: l.alias.tallyStockItem,                          // alias as Tally stock item
      gstovrdntaxability: isUnreg ? 'Exempt' : 'Taxable',
      gstovrdnineligibleitc: '\u0004 Not Applicable',
      gstovrdnisrevchargeappl: '\u0004 Not Applicable',
      gstsourcetype: 'Stock Item',
      gstitemsource: l.alias.tallyStockItem,
      hsnsourcetype: 'Stock Item',
      hsnitemsource: l.alias.tallyStockItem,
      gstovrdntypeofsupply: 'Goods',
      gstrateinferapplicability: 'As per Masters/Company',
      gsthsninferapplicability: 'As per Masters/Company',
      isdeemedpositive: true,
      rate: `${l.rate.toFixed(2)}/${l.unit}`,
      amount: neg(l.amount),
      actualqty: ` ${l.qty.toFixed(2)} ${l.unit}`,
      billedqty: ` ${l.qty.toFixed(2)} ${l.unit}`,
      ratedetails: isUnreg
        ? [
            { gstratedutyhead: 'CGST',       gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'SGST/UTGST', gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'IGST',       gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'Cess',       gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'State Cess', gstratevaluationtype: '\u0004 Not Applicable' },
          ]
        : [
            { gstratedutyhead: 'CGST',       gstratevaluationtype: 'Based on Value', gstrate: ` ${half}` },
            { gstratedutyhead: 'SGST/UTGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${half}` },
            { gstratedutyhead: 'IGST',       gstratevaluationtype: 'Based on Value', gstrate: ` ${rate}` },
            { gstratedutyhead: 'Cess',       gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'State Cess', gstratevaluationtype: 'Based on Value' },
          ],
      basicuserdescription: [l.description || l.item.displayName],     // real item name
      batchallocations: [{
        godownname: godown,
        destinationgodownname: godown,
        batchname: invoice.supplierInvoiceNo,
        amount: neg(l.amount),
        actualqty: ` ${l.qty.toFixed(2)} ${l.unit}`,
        billedqty: ` ${l.qty.toFixed(2)} ${l.unit}`,
      }],
      accountingallocations: [{
        ledgername: purchaseLedger,
        isdeemedpositive: true,
        ispartyledger: false,
        amount: neg(l.amount),
      }],
    }
  })

  // Ledger entries
  const ledgerentries: any[] = [
    { ledgername: party.tallyLedger, isdeemedpositive: false, ispartyledger: true, amount: '0.00' },
  ]
  if (!isUnreg) {
    const linesByRate: Record<string, number> = {}
    for (const l of lines) {
      const r = String(l.alias.gstRate)
      linesByRate[r] = (linesByRate[r] || 0) + l.amount
    }
    for (const [rate, taxable] of Object.entries(linesByRate)) {
      const totalGst = +(taxable * (parseFloat(rate) / 100)).toFixed(2)
      if (isIntra) {
        const half = +(totalGst / 2).toFixed(2)
        const halfRate = String(parseFloat(rate) / 2)
        ledgerentries.push({ ledgername: cfg.gstLedgers.CGST[halfRate], isdeemedpositive: true, ispartyledger: false, amount: neg(half), vatexpamount: neg(half) })
        ledgerentries.push({ ledgername: cfg.gstLedgers.SGST[halfRate], isdeemedpositive: true, ispartyledger: false, amount: neg(half), vatexpamount: neg(half) })
      } else {
        ledgerentries.push({ ledgername: cfg.gstLedgers.IGST[rate], isdeemedpositive: true, ispartyledger: false, amount: neg(totalGst), vatexpamount: neg(totalGst) })
      }
    }
  }

  if (invoice.freightAmount > 0) {
    ledgerentries.push({
      ledgername: cfg.freightLedger,
      appropriatefor: 'GST', gstappropriateto: 'Goods and Services',
      excisealloctype: 'Based on Value',
      isdeemedpositive: true, ispartyledger: false,
      amount: neg(invoice.freightAmount), vatexpamount: neg(invoice.freightAmount),
    })
  }
  if (invoice.totalDiscountAmount > 0) {
    ledgerentries.push({
      ledgername: cfg.discountLedger,
      appropriatefor: 'GST', gstappropriateto: 'Goods and Services',
      excisealloctype: 'Based on Value',
      isdeemedpositive: true, ispartyledger: false,
      amount: invoice.totalDiscountAmount.toFixed(2),
      vatexpamount: invoice.totalDiscountAmount.toFixed(2),
    })
  }

  // Round-off (port from existing tally-push)
  const taxableSum = lines.reduce((s, l) => s + l.amount, 0)
  let dr = taxableSum
  for (const e of ledgerentries) {
    if (e.ispartyledger) continue
    const a = parseFloat(String(e.amount))
    if (a < 0) dr += -a; else dr -= a
  }
  const exactFinal = +dr.toFixed(2)
  const roundedFinal = Math.round(exactFinal)
  const shortfall = +(exactFinal - roundedFinal).toFixed(2)
  if (Math.abs(shortfall) > 0.001) {
    const roundAmt = shortfall > 0 ? shortfall.toFixed(2) : neg(Math.abs(shortfall))
    ledgerentries.push({
      ledgername: cfg.roundOffLedger,
      isdeemedpositive: shortfall < 0, ispartyledger: false,
      amount: roundAmt, vatexpamount: roundAmt,
    })
  }
  ledgerentries[0].amount = roundedFinal.toFixed(2)

  return {
    static_variables: [
      { name: 'svVchImportFormat', value: 'jsonex' },
      { name: 'svCurrentCompany', value: KSI_TALLY },
    ],
    tallymessage: [{
      metadata: {
        type: 'Voucher',
        remoteid: `INV-KSI-${invoice.id}`,
        vchtype: 'Purchase',
        action: 'Create',
        objview: 'Invoice Voucher View',
      },
      date: fmtDate(String(invoice.supplierInvoiceDate)),
      referencedate: fmtDate(String(invoice.supplierInvoiceDate)),
      vouchertypename: 'Purchase',
      partyname: party.tallyLedger,
      partyledgername: party.tallyLedger,
      partymailingname: party.tallyLedger,
      consigneemailingname: KSI_TALLY,
      vouchernumber: invoice.supplierInvoiceNo,
      reference: invoice.supplierInvoiceNo,
      basicbuyername: KSI_TALLY,
      basicbasepartyname: party.tallyLedger,
      countryofresidence: 'India',
      consigneecountryname: 'India',
      consigneestatename: KSI_STATE,
      cmpgststate: KSI_STATE,
      consigneegstregistrationtype: 'Regular',
      cmpgstregistrationtype: 'Regular',
      numberingstyle: 'Manual',
      persistedview: 'Invoice Voucher View',
      vchentrymode: 'Item Invoice',
      isinvoice: true,
      effectivedate: fmtDate(String(invoice.supplierInvoiceDate)),
      ...(party.gstin ? { partygstin: party.gstin } : { partygstin: '' }),
      ...(party.state ? { statename: party.state } : {}),
      placeofsupply: party.state || KSI_STATE,
      gstregistrationtype: party.gstRegistrationType,
      narration: `App push. Series: ${invoice.linkedChallanSeries.join(', ')}.`,
      allinventoryentries,
      ledgerentries,
      diffactualqty: false, ismstfromsync: false, isdeleted: false,
      asoriginal: false, audited: false, forjobcosting: false, isoptional: false,
      issystem: false, isfetchedonly: false,
    }],
  }
}
```

### 6.4 Pre-Push Validation Checklist

| Check | Block? |
|-------|--------|
| All invoice lines' items are `approved` | yes |
| Party `tallyLedger` present | yes |
| For Regular party: required GST ledger names exist for all rates | yes |
| For each alias category: `purchaseLedgerMap[category]` configured | yes |
| For each alias category: `godownMap[category]` configured (unless alias `godownOverride`) | yes |
| For each line: real item `unit` matches alias `unit` | yes |
| `TALLY_TUNNEL_URL` env present | yes |
| All lines have non-null `rate` and `amount` | yes |
| Description per line ≤ 240 chars | yes (truncate with warning) |

Failures return `409 Conflict` with detailed error list; UI renders as
a checklist.

---

## 7. Drive Storage

```
<DRIVE_ROOT>/Inward/KSI/
  <YYYY-MM>/<PartyName>/<ChallanNo>/
    challan_photo_*.jpg, lr_copy.pdf, weighing.jpg
  Invoices/<YYYY-MM>/<PartyName>/<SupplierInvoiceNo>.pdf
  POs/<FY>/<PO_No>.pdf
```

Service-account auth (env already in repo). Each upload stores
`driveFileId` + `driveViewUrl`.

---

## 8. Validations & Edge Cases

1. Same `(partyId, challanNo)` ±3 days → block save (duplicate guard)
2. Same `(partyId, supplierInvoiceNo)` → block save
3. New item: `aliasId` required; unit must match alias unit; GST
   override (if set) must equal alias rate
4. Pending-review item in invoice line → push blocked
5. Rejected item in challan line → challan cannot be Verified until
   line edited
6. Alias mapping change blocked if item used in any pushed invoice
7. Invoice line qty < linked challan line qty → allowed (partial
   billing); excess qty stays as PendingInvoice on challan
8. Invoice qty > challan qty → require text reason
9. Backdated invoice (invoiceDate < challanDate) → block (illegal)
10. Backdated challan >7 days → require manager approval
11. Voiding invoice frees challans back to PendingInvoice
12. Tally connection down → status PushPending; worker retries; after
    12 attempts WhatsApp owner
13. Decimal precision: qty 3 dp, rate 4 dp
14. Description >240 chars → truncate with warning
15. Concurrent edits → optimistic lock on `updatedAt`
16. Rate variance >7% → status PendingApproval (manager unblock)
17. Rate variance 3–7% → require reason text
18. Same item twice in one challan → soft warning
19. Cancelled challan retains series number — never reused
20. Header default discount removed → modal: "Apply to inherited lines?"

---

## 9. Acceptance Criteria (MVP)

- [ ] Operator creates 3-line challan from a known party in <60s; series auto-assigned
- [ ] Same supplier challanNo for same party blocks save
- [ ] Tier-A items render <200ms
- [ ] Last-3-rates render <200ms
- [ ] PO link pre-fills challan lines; receivedQty updates correctly
- [ ] Pending-review item: usable in challan, but invoice push 409s
- [ ] Verified challan with chemicals/dyes creates `InvStockMovement` IN entries
- [ ] Header default discount auto-applies; line override preserved
- [ ] Series Gap Report shows full series with cancelled flagged
- [ ] Invoice screen lists pending challans of party; multi-select loads lines
- [ ] IGST vs CGST/SGST decided correctly from `KSI_STATE` vs `party.state`
- [ ] Unregistered party invoice pushes without GST ledger entries
- [ ] Push creates Purchase voucher in Tally Day Book; description shows real item name
- [ ] After push, linked challans flip to `Invoiced`
- [ ] Voiding an invoice frees challans back to `PendingInvoice`
- [ ] Daily 8pm WhatsApp PDF lands with: today's inward + open POs + pending-invoice challans + pending-review items + series gaps
- [ ] All actions audited

---

## 10. Build Order

1. **Prisma schema migration** — add `Inv*` models + extend `Party`;
   drop legacy `PurchaseOrder`, `PurchaseOrderItem`, `DeliveryChallan`,
   `DeliveryChallanItem`, `InventoryCategory`, `InventoryItem`,
   `InventoryTransaction`, `PhysicalStockEntry`, `InventoryItemAlias`
   tables (no data to preserve)
2. Master sync from Tally — parties + alias items endpoints
3. Real-items module: list + create + CSV import
4. Item Review Queue
5. Party + Item picker components
6. Series counter atomic allocator + tests
7. Inward Challan create / list / edit + Drive uploads + duplicate guard
8. Stock IN movement on challan verify
9. PO module + WhatsApp share
10. Discount system
11. Purchase Invoice module
12. Pre-push validation engine
13. Tally JSON push + retry worker
14. Daily reports + WhatsApp digests + Series Gap Report

**Phase 2:** GSTR import + matching, RCM, OCR challan scan, voice
entry, damage module, stock ledger UI, internal series for POs and
invoices.

---

## 11. Environment

Already-present vars used by this module:

```
DATABASE_URL=...
DIRECT_URL=...
TALLY_TUNNEL_URL=...
CF_ACCESS_CLIENT_ID=...
CF_ACCESS_CLIENT_SECRET=...
GOOGLE_SERVICE_ACCOUNT_KEY=...
CHATMITRA_API_KEY=...
```

New vars for this module:

```
KSI_STATE=Rajasthan
KSI_TALLY_COMPANY=Kothari Synthetic Industries
```

---

**End of PRD.**
