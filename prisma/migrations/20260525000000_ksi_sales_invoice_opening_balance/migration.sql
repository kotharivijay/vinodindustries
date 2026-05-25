-- Manual opening-balance entry for a prior FY (added by the operator, not
-- synced from Tally). ksi-sales-sync upsert skips rows where this is true.
ALTER TABLE "KsiSalesInvoice" ADD COLUMN "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "KsiSalesInvoice_isOpeningBalance_idx" ON "KsiSalesInvoice"("isOpeningBalance");
