-- Transport payment vouchers: one payment to a transporter/agent (e.g.
-- "Sakar") covers many despatch challans. DespatchEntry.transportPaymentId
-- null = freight not yet settled for that challan.

CREATE TABLE "TransportPayment" (
  "id" SERIAL NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "paidTo" TEXT NOT NULL,
  "amount" DECIMAL(16,2),
  "mode" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TransportPayment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DespatchEntry" ADD COLUMN "transportPaymentId" INTEGER;

ALTER TABLE "DespatchEntry"
  ADD CONSTRAINT "DespatchEntry_transportPaymentId_fkey"
  FOREIGN KEY ("transportPaymentId") REFERENCES "TransportPayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DespatchEntry_transportPaymentId_idx"
  ON "DespatchEntry"("transportPaymentId");
