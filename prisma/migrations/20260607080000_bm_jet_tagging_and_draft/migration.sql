-- AlterTable: BatchMakingSlipBatch — add nullable jet planning fields
ALTER TABLE "BatchMakingSlipBatch"
    ADD COLUMN "jetNo"      INTEGER,
    ADD COLUMN "jetSerial"  INTEGER;

-- CreateTable: BatchMakingDraft — one row per user, stores in-progress
-- selection + jet tags so the operator can resume after closing the page.
CREATE TABLE "BatchMakingDraft" (
    "id"             SERIAL NOT NULL,
    "userEmail"      TEXT   NOT NULL,
    "date"           TIMESTAMP(3) NOT NULL,
    "batchMakerName" TEXT   NOT NULL,
    "notes"          TEXT,
    "tagMode"        BOOLEAN NOT NULL DEFAULT false,
    "data"           JSONB  NOT NULL,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchMakingDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BatchMakingDraft_userEmail_key" ON "BatchMakingDraft"("userEmail");
