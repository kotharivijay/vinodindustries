-- Adds the column behind commit bb8d6aa ("feat(inv): per-party Tally purchase
-- ledger override"). The field was added to schema.prisma and is read by
-- lib/inv/tally-push.ts, lib/inv/pre-push-validate.ts, the parties API and the
-- parties page, but no migration was ever written — so the column was missing
-- from the database.
--
-- Consequence: EVERY Prisma read of InvParty without an explicit `select`
-- (Prisma selects all scalar columns) failed with P2022
-- "The column InvParty.purchaseLedgerOverride does not exist". That broke
-- resolvePartyIdByLedger() and therefore saving a new Inward Challan — the API
-- 500'd, the client's `await res.json()` threw on the HTML error page, and with
-- no catch around it the Save Draft button silently did nothing.

ALTER TABLE "InvParty" ADD COLUMN IF NOT EXISTS "purchaseLedgerOverride" TEXT;
