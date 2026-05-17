# Grey Checking — Feature Summary

Intermediate review stage between grey-inward and fold/dye. Operator picks
in-stock lots, records a checker's findings on a slip, and optionally shares
a "Checking Program" list on WhatsApp before the physical check happens.

Lives under the existing `/grey` page as a third tab + a popup modal.

---

## Final logic

### 1. Slip = a checker's session

A `CheckingSlip` is a single inspection event by one checker (Tulsaram /
Opened / …) on a specific date. Each slip carries one or more `CheckingSlipLot`
rows, each tied to a specific bale row of `GreyEntry` (via `greyEntryId` FK)
and snapshotting `lotNo` + `than` + `baleNo` so the slip stays stable if the
grey row is edited later.

### 2. PC Job parties get partial checking, others don't

Detection: `entry.party.tag === 'Pali PC Job'` (15 such parties).

| Behavior | Pali PC Job | Other parties |
|---|---|---|
| One slip checks the whole lot? | No — multiple slips can each record a partial than | Yes — first slip records the full grey than |
| Editable than input on card? | Yes (1 … remaining, clamped) | No — fixed at full lot than |
| Remaining-badge on card | `Remaining 40 / 60 · 20 already checked` | none |
| When does the lot leave the picker? | When `Σ CheckingSlipLot.than ≥ GreyEntry.than` | On the first save (Σ = full) |

`remainingThan(e) = max(0, e.than − Σ CheckingSlipLot.than where lotNo matches)`.

### 3. Lot-level selection (no partial bale picks)

Clicking any bale card toggles every bale row sharing that `lotNo`. After
the duplicate-PS-44 cleanup, every lot has exactly one `GreyEntry` row, so
in practice this is a per-row toggle — but the lot-level rule survives if a
multi-bale lot is ever entered.

### 4. Two inner tabs in the modal

- **✏️ Save Slip** — date, slip-no (auto `CHK-####`, editable), checker
  dropdown (`Tulsaram` / `Opened` / + Add new…), Save Checking button →
  POST creates the slip + lots.
- **📋 Checking Program** — date only, no slip-no / checker. Renders the
  selected lots as a 720 px portrait PNG (header + table + grand total) and
  shares via the Web Share API (mobile) or downloads + opens
  `wa.me/?text=…` (desktop). No DB write.

Selection, search filters, and date are **shared across both tabs**.

### 5. Delete guard on grey rows

`DELETE /api/grey/[id]` refuses to delete a `GreyEntry` whose `lotNo` is
referenced anywhere downstream:
`CheckingSlipLot` (per-row FK) · `FoldBatchLot` · `FoldingSlipLot` ·
`DyeingEntryLot` · `FinishEntryLot` · `PackingLot` · `DespatchEntry` +
`DespatchEntryLot`. All checks are case-insensitive on `lotNo`.

### 6. Share PNG layout (720 × auto-height)

| col | x | width | content |
|---|---|---|---|
| # | 16 | 30 | row number |
| Lot | 50 | 100 | bold indigo, max 12 chars |
| Party | 150 | 160 | max 20 chars |
| Quality | 310 | 120 | max 14 chars |
| LR | 430 | 60 | grey, max 8 chars |
| Bale | 490 | 85 | grey, max 11 chars |
| Marka | 575 | 130 | bold amber when present, dash when null |
| Than | 704 | right | bold, the **check-than** (partial for PC Job) |

Footer: dark band with grand total than (sum of `checkThan`, not lot.than).

---

## Names

### Prisma models (`prisma/schema.prisma:93-128`)

- `Checker` — master list. `name @unique`, `isActive`.
- `CheckingSlip` — `slipNo @unique`, `date`, `checkerName`, `notes?`,
  `status` (`confirmed|cancelled`), `lots[]`.
- `CheckingSlipLot` — `checkingSlipId` FK (cascade), `greyEntryId` FK
  (restrict), snapshots: `lotNo` `than` `baleNo`. Unique
  `(checkingSlipId, greyEntryId)`.
- `GreyEntry.checkingLots: CheckingSlipLot[]` — back-relation.

### Migration

`prisma/migrations/20260513000000_add_grey_checking/migration.sql` —
creates 3 tables + FKs + seeds `Checker` rows for **Tulsaram** and
**Opened**.

### Components

- `app/(dashboard)/grey/GreyCheckingModal.tsx` — the popup. Holds inner tabs,
  selection `Map<greyEntryId, than>`, search filters, PC Job partial logic,
  PNG renderer, share flow.
- `app/(dashboard)/grey/page.tsx` — third tab **Checking Slips** with list
  + card expander + delete; `CheckingSlipsPanel` component near the bottom.

### Page button

`/grey` header has a teal **🔍 Grey Checking** button that opens the modal.

---

## API

All routes require a NextAuth session.

### `GET /api/grey/checking`

Returns every slip with its lots (and `_count.lots`), newest first.
Used by:
- `CheckingSlipsPanel` (the list view).
- Modal `existingSlips` SWR → builds `checkedThanByLot` map to hide
  fully-checked lots and show "remaining" on PC Job rows.

### `POST /api/grey/checking`

Body (new shape):
```json
{
  "slipNo": "CHK-0042",
  "date": "2026-05-17",
  "checkerName": "Tulsaram",
  "notes": "Patchy on edge",
  "lots": [
    { "greyEntryId": 6017, "than": 20 },
    { "greyEntryId": 6234, "than": 60 }
  ]
}
```
Legacy shape `{ greyEntryIds: [6017, 6234] }` still accepted — each id is
treated as full-than.

Validation per pick (server, [`app/api/grey/checking/route.ts`](app/api/grey/checking/route.ts)):
1. Each `greyEntryId` must exist.
2. `remaining = greyEntry.than − Σ prior CheckingSlipLot.than for lotNo`
3. `remaining > 0` or 400 "Lot X is already fully checked".
4. Non-PC-Job picks are clamped to `remaining` (caller's `than` ignored).
5. PC Job picks must satisfy `1 ≤ than ≤ remaining`.
6. Within the same request, sum of `than` per lot ≤ remaining.
7. Stores `lotNo` normalized via `normalizeLotNo()` so the snapshot
   matches the canonical casing used elsewhere.

### `GET /api/grey/checking/[id]`

Single slip with its lots — for detail views.

### `DELETE /api/grey/checking/[id]`

Drops the slip; `CheckingSlipLot` rows cascade.

### `GET /api/grey/checking/next-slip-no`

Suggests next `CHK-####` by reading max numeric suffix across existing
slip-nos and incrementing. Non-numeric slip-nos (operator overrides) are
ignored.

### `GET /api/checkers` · `POST /api/checkers`

Master list for the checker dropdown. POST upserts by name (used by
"+ Add new…" inside the modal).

### `DELETE /api/grey/[id]` — downstream guard

Not new in this feature, but extended for it. See
[`app/api/grey/[id]/route.ts`](app/api/grey/%5Bid%5D/route.ts) — blocks
delete with HTTP 409 if the lot has any downstream slip activity
(checking / fold / dye / finish / pack / despatch).

---

## Quick reference paths

- Models: [prisma/schema.prisma:93-128](prisma/schema.prisma#L93-L128)
- Migration: [prisma/migrations/20260513000000_add_grey_checking/migration.sql](prisma/migrations/20260513000000_add_grey_checking/migration.sql)
- Modal: [app/(dashboard)/grey/GreyCheckingModal.tsx](app/(dashboard)/grey/GreyCheckingModal.tsx)
- Slip list panel + tab wiring: [app/(dashboard)/grey/page.tsx](app/(dashboard)/grey/page.tsx)
- POST/GET slips: [app/api/grey/checking/route.ts](app/api/grey/checking/route.ts)
- Single slip routes: [app/api/grey/checking/[id]/route.ts](app/api/grey/checking/%5Bid%5D/route.ts)
- Next slip-no: [app/api/grey/checking/next-slip-no/route.ts](app/api/grey/checking/next-slip-no/route.ts)
- Checker master: [app/api/checkers/route.ts](app/api/checkers/route.ts)
- Delete guard: [app/api/grey/[id]/route.ts](app/api/grey/%5Bid%5D/route.ts)
