-- Link a FinishEntryLot row back to the specific DyeingEntry whose
-- production it consumed. Nullable: legacy rows stay NULL and the stock
-- route falls back to FIFO for those (see app/api/finish/stock).
ALTER TABLE "FinishEntryLot" ADD COLUMN "dyeingEntryId" INTEGER;

CREATE INDEX "FinishEntryLot_dyeingEntryId_idx" ON "FinishEntryLot"("dyeingEntryId");

ALTER TABLE "FinishEntryLot"
  ADD CONSTRAINT "FinishEntryLot_dyeingEntryId_fkey"
  FOREIGN KEY ("dyeingEntryId") REFERENCES "DyeingEntry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
