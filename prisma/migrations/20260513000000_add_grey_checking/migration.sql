-- CreateTable: Checker (master list — Tulsaram, Opened, …)
CREATE TABLE "Checker" (
    "id"        SERIAL NOT NULL,
    "name"      TEXT   NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Checker_name_key" ON "Checker"("name");

-- CreateTable: CheckingSlip
CREATE TABLE "CheckingSlip" (
    "id"          SERIAL NOT NULL,
    "slipNo"      TEXT   NOT NULL,
    "date"        TIMESTAMP(3) NOT NULL,
    "checkerName" TEXT   NOT NULL,
    "notes"       TEXT,
    "status"      TEXT   NOT NULL DEFAULT 'confirmed',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckingSlip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckingSlip_slipNo_key" ON "CheckingSlip"("slipNo");

-- CreateTable: CheckingSlipLot
CREATE TABLE "CheckingSlipLot" (
    "id"             SERIAL NOT NULL,
    "checkingSlipId" INTEGER NOT NULL,
    "greyEntryId"    INTEGER NOT NULL,
    "lotNo"          TEXT   NOT NULL,
    "than"           INTEGER NOT NULL,
    "baleNo"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckingSlipLot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckingSlipLot_checkingSlipId_greyEntryId_key"
    ON "CheckingSlipLot"("checkingSlipId", "greyEntryId");

-- AddForeignKey: CheckingSlipLot → CheckingSlip
ALTER TABLE "CheckingSlipLot"
    ADD CONSTRAINT "CheckingSlipLot_checkingSlipId_fkey"
    FOREIGN KEY ("checkingSlipId") REFERENCES "CheckingSlip"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CheckingSlipLot → GreyEntry
ALTER TABLE "CheckingSlipLot"
    ADD CONSTRAINT "CheckingSlipLot_greyEntryId_fkey"
    FOREIGN KEY ("greyEntryId") REFERENCES "GreyEntry"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed default checkers
INSERT INTO "Checker" ("name") VALUES ('Tulsaram'), ('Opened')
ON CONFLICT ("name") DO NOTHING;
