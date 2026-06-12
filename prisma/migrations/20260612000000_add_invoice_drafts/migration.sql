-- CreateTable
CREATE TABLE "InvPurchaseInvoiceDraft" (
    "id" SERIAL NOT NULL,
    "partyId" INTEGER NOT NULL,
    "challanIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "lines" JSONB NOT NULL,
    "freightAmount" DECIMAL(14,2),
    "otherCharges" DECIMAL(14,2),
    "discountAmount" DECIMAL(14,2),
    "notes" TEXT,
    "gstTreatment" TEXT,
    "taxableAmount" DECIMAL(16,2),
    "igstAmount" DECIMAL(14,2),
    "cgstAmount" DECIMAL(14,2),
    "sgstAmount" DECIMAL(14,2),
    "totalAmount" DECIMAL(16,2),
    "hasPendingReviewItems" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "promotedInvoiceId" INTEGER,
    "promotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvPurchaseInvoiceDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvPurchaseInvoiceDraft_partyId_idx" ON "InvPurchaseInvoiceDraft"("partyId");

-- CreateIndex
CREATE INDEX "InvPurchaseInvoiceDraft_promotedAt_idx" ON "InvPurchaseInvoiceDraft"("promotedAt");

-- AddForeignKey
ALTER TABLE "InvPurchaseInvoiceDraft" ADD CONSTRAINT "InvPurchaseInvoiceDraft_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "InvParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
