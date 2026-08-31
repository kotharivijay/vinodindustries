-- Grey Return: unprocessed cloth going back to the party, either plain grey
-- that was never folded or cloth folded but not yet dyed. Until now the only
-- way to get grey out of the books was a DespatchEntry (which implies
-- processed goods went out) or cancelling a fold batch (a reservation release,
-- not a physical movement).
--
-- A saved return feeds the SAME delivery-challan queue as a finish program, so
-- FinishDeliveryChallanLine grows a second, mutually-exclusive source.

-- CreateTable: GreyReturn (the slip)
CREATE TABLE "GreyReturn" (
    "id"             SERIAL       NOT NULL,
    "slipNo"         TEXT         NOT NULL,            -- "GR-7"
    "serialNo"       INTEGER      NOT NULL,            -- from InvSeriesCounter
    "fy"             TEXT         NOT NULL,
    "date"           TIMESTAMP(3) NOT NULL,
    "partyId"        INTEGER      NOT NULL,
    "status"         TEXT         NOT NULL DEFAULT 'issued', -- issued | cancelled
    "notes"          TEXT,
    "createdByEmail" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GreyReturn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GreyReturn_slipNo_key" ON "GreyReturn"("slipNo");
CREATE INDEX "GreyReturn_partyId_idx" ON "GreyReturn"("partyId");
CREATE INDEX "GreyReturn_date_idx" ON "GreyReturn"("date");

-- CreateTable: GreyReturnLot (child rows, snapshotted like CheckingSlipLot)
CREATE TABLE "GreyReturnLot" (
    "id"             SERIAL       NOT NULL,
    "greyReturnId"   INTEGER      NOT NULL,
    "lotNo"          TEXT         NOT NULL,
    "source"         TEXT         NOT NULL,            -- grey | fold
    "qualityName"    TEXT,
    "marka"          TEXT,
    "than"           INTEGER      NOT NULL,
    "foldBatchLotId" INTEGER,                          -- fold line that was reduced
    "checkingSlipNo" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GreyReturnLot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GreyReturnLot_greyReturnId_idx" ON "GreyReturnLot"("greyReturnId");
CREATE INDEX "GreyReturnLot_lotNo_idx" ON "GreyReturnLot"("lotNo");

-- AlterTable: FinishDeliveryChallanLine gains a second source.
-- The three finish-specific columns become nullable so a grey-return line can
-- exist. Postgres permits multiple NULLs in a unique index, so the existing
-- unique on finishEntryLotId still prevents double-issuing a finish lot.
ALTER TABLE "FinishDeliveryChallanLine" ALTER COLUMN "finishEntryLotId" DROP NOT NULL;
ALTER TABLE "FinishDeliveryChallanLine" ALTER COLUMN "finishEntryId"    DROP NOT NULL;
ALTER TABLE "FinishDeliveryChallanLine" ALTER COLUMN "finishSlipNo"     DROP NOT NULL;
ALTER TABLE "FinishDeliveryChallanLine" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'finish';
ALTER TABLE "FinishDeliveryChallanLine" ADD COLUMN "greyReturnLotId" INTEGER;

CREATE UNIQUE INDEX "FinishDeliveryChallanLine_greyReturnLotId_key"
    ON "FinishDeliveryChallanLine"("greyReturnLotId");
CREATE INDEX "FinishDeliveryChallanLine_greyReturnLotId_idx"
    ON "FinishDeliveryChallanLine"("greyReturnLotId");

-- Exactly one source per line. Prisma can't express CHECK constraints, so this
-- lives in raw SQL (same approach as ProcessRateContract's partial unique
-- index). This is the guard that stops a line being orphaned or double-sourced.
ALTER TABLE "FinishDeliveryChallanLine"
    ADD CONSTRAINT "FinishDeliveryChallanLine_one_source"
    CHECK (("finishEntryLotId" IS NOT NULL)::int + ("greyReturnLotId" IS NOT NULL)::int = 1);

-- AddForeignKey
ALTER TABLE "GreyReturn"
    ADD CONSTRAINT "GreyReturn_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GreyReturnLot"
    ADD CONSTRAINT "GreyReturnLot_greyReturnId_fkey"
    FOREIGN KEY ("greyReturnId") REFERENCES "GreyReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, mirroring the finishEntryLot relation: a returned lot that is
-- already on a challan must not vanish underneath it.
ALTER TABLE "FinishDeliveryChallanLine"
    ADD CONSTRAINT "FinishDeliveryChallanLine_greyReturnLotId_fkey"
    FOREIGN KEY ("greyReturnLotId") REFERENCES "GreyReturnLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
