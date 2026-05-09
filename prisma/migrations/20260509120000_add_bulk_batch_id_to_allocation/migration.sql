-- AlterTable: tag bulk-link allocations with a shared UUID so the
-- detail page can pull every receipt + invoice from the same batch.
ALTER TABLE "KsiReceiptAllocation" ADD COLUMN "bulkBatchId" TEXT;

-- CreateIndex
CREATE INDEX "KsiReceiptAllocation_bulkBatchId_idx" ON "KsiReceiptAllocation"("bulkBatchId");
