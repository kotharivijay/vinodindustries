-- Manual add/less on a staff wage entry's opening carry (standalone carry adjust).
ALTER TABLE "MonthlyWageEntry" ADD COLUMN IF NOT EXISTS "openingAdjust" DOUBLE PRECISION NOT NULL DEFAULT 0;
