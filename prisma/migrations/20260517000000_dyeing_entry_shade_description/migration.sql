-- Per-slip shade descriptor. Lets the user type the actual colour for
-- generic recipes (Hitset / APC → "Red", "Rani") directly on the dyeing
-- slip form, without needing a fold batch link to persist it.
ALTER TABLE "DyeingEntry" ADD COLUMN "shadeDescription" TEXT;
