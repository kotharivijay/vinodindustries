-- Adds per-party default + per-challan override for the Delivery Challan
-- "Show Extra Charges" (Freight + Checking chips) block.

ALTER TABLE "Party"
  ADD COLUMN "billExtraChargesDefault" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FinishDeliveryChallan"
  ADD COLUMN "showExtraCharges" BOOLEAN NOT NULL DEFAULT false;
