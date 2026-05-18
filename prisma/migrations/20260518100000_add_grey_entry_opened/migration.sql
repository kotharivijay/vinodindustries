-- Lot-opening flag. Lets the floor mark a lot's bales as physically opened
-- without creating a CheckingSlip. Toggled lot-wide in the UI (every bale
-- of the lot gets the same timestamp). openedByEmail snapshots the session
-- user; no FK because the app has no User table.
ALTER TABLE "GreyEntry"
  ADD COLUMN "openedAt" TIMESTAMP(3),
  ADD COLUMN "openedByEmail" TEXT;
