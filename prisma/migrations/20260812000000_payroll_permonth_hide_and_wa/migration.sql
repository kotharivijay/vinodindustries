-- Per-month contractor hide on the wages page (independent month to month).
-- The legacy Contractor.hiddenInWages stays as a global fallback.
ALTER TABLE "ContractorMonthlyBalance" ADD COLUMN IF NOT EXISTS "hiddenInWages" BOOLEAN NOT NULL DEFAULT false;

-- Saved contractor WhatsApp number for the wages summary share.
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "whatsappNo" TEXT;
