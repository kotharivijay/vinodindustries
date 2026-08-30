-- Process rates are always quoted per THAN in this business. `kg` was only ever
-- the column default and was never a real choice: weight is not stored
-- numerically anywhere (GreyEntry.weight is free text like "106g"), so a
-- per-kg rate could never yield an amount on the delivery-challan view.
--
-- Convert every existing per-kg rate line to per-than (the rate values are
-- already the per-than figures — the unit label was the error) and make `than`
-- the column default so new lines can't inherit `kg` again.

UPDATE "ProcessRateLine" SET "unit" = 'than' WHERE "unit" = 'kg';

ALTER TABLE "ProcessRateLine" ALTER COLUMN "unit" SET DEFAULT 'than';

-- Contracts never used a kg validity cap (verified: all rows are 'than' or
-- NULL), so no data change is needed there; the UI + validator now offer only
-- than / mtr.
