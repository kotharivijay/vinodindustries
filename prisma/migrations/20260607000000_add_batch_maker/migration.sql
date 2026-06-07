-- CreateTable: BatchMaker (master list — Sanker, …)
CREATE TABLE "BatchMaker" (
    "id"        SERIAL NOT NULL,
    "name"      TEXT   NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchMaker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BatchMaker_name_key" ON "BatchMaker"("name");

-- CreateTable: BatchMakingSlip
CREATE TABLE "BatchMakingSlip" (
    "id"             SERIAL NOT NULL,
    "slipNo"         TEXT   NOT NULL,
    "serialNo"       INTEGER NOT NULL,
    "fy"             TEXT   NOT NULL,
    "date"           TIMESTAMP(3) NOT NULL,
    "batchMakerName" TEXT   NOT NULL,
    "notes"          TEXT,
    "status"         TEXT   NOT NULL DEFAULT 'confirmed',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchMakingSlip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BatchMakingSlip_slipNo_key" ON "BatchMakingSlip"("slipNo");

-- CreateTable: BatchMakingSlipBatch
CREATE TABLE "BatchMakingSlipBatch" (
    "id"                  SERIAL NOT NULL,
    "slipId"              INTEGER NOT NULL,
    "foldBatchId"         INTEGER NOT NULL,
    -- mirrors parent slip status so the partial unique index below can be
    -- gated by status without referencing another table
    "slipStatus"          TEXT   NOT NULL DEFAULT 'confirmed',
    "foldNoSnapshot"      TEXT   NOT NULL,
    "batchNoSnapshot"     INTEGER NOT NULL,
    "shadeNameSnapshot"   TEXT,
    "markaSnapshot"       TEXT,
    "totalThanSnapshot"   INTEGER NOT NULL,
    "totalWeightSnapshot" DECIMAL(10,2) NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchMakingSlipBatch_pkey" PRIMARY KEY ("id")
);

-- Partial unique index: a FoldBatch may appear on at most ONE confirmed BM
-- slip at a time. Cancelled rows are excluded so cancellation re-opens the
-- batch for a fresh slip without losing audit history.
CREATE UNIQUE INDEX "BatchMakingSlipBatch_active_foldBatch_uniq"
    ON "BatchMakingSlipBatch"("foldBatchId")
    WHERE "slipStatus" = 'confirmed';

-- AddForeignKey: BatchMakingSlipBatch → BatchMakingSlip
ALTER TABLE "BatchMakingSlipBatch"
    ADD CONSTRAINT "BatchMakingSlipBatch_slipId_fkey"
    FOREIGN KEY ("slipId") REFERENCES "BatchMakingSlip"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: BatchMakingSlipBatch → FoldBatch
ALTER TABLE "BatchMakingSlipBatch"
    ADD CONSTRAINT "BatchMakingSlipBatch_foldBatchId_fkey"
    FOREIGN KEY ("foldBatchId") REFERENCES "FoldBatch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed default batch maker
INSERT INTO "BatchMaker" ("name") VALUES ('Sanker')
ON CONFLICT ("name") DO NOTHING;
