-- Per-line transport snapshot for delivery-challan rows. Populated at
-- create time from the source GreyEntry so the printed challan stays
-- stable even when the grey row is edited later.

ALTER TABLE "FinishDeliveryChallanLine"
  ADD COLUMN "transportName" TEXT,
  ADD COLUMN "transportLrNo" TEXT;
