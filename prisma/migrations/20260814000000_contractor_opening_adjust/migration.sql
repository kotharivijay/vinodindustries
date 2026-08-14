-- Manual add/less on a contractor pool's opening carry.
ALTER TABLE "ContractorMonthlyBalance" ADD COLUMN IF NOT EXISTS "openingAdjust" DOUBLE PRECISION NOT NULL DEFAULT 0;
