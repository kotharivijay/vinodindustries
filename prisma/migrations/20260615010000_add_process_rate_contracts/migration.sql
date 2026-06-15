-- Process Rate Contracts: party-level, versioned dyeing/heatset rate cards.
-- See schema.prisma block "Process Rate Contracts" for the model rationale.

-- CreateTable: ProcessType (master — extensible at runtime, not an enum)
CREATE TABLE "ProcessType" (
    "id"        SERIAL NOT NULL,
    "code"      TEXT   NOT NULL,
    "name"      TEXT   NOT NULL,
    "rateMode"  TEXT   NOT NULL, -- FLAT | BY_COLOR_CATEGORY
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProcessType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessType_code_key" ON "ProcessType"("code");

-- CreateTable: ProcessRateContract (versioned, per-party)
CREATE TABLE "ProcessRateContract" (
    "id"             SERIAL NOT NULL,
    "partyId"        INTEGER NOT NULL,
    "version"        INTEGER NOT NULL,
    "status"         TEXT   NOT NULL DEFAULT 'active', -- active | superseded | cancelled
    "effectiveFrom"  TIMESTAMP(3) NOT NULL,
    "validityQty"    DECIMAL(14,3),
    "validityUnit"   TEXT,            -- than | kg | mtr
    "notes"          TEXT,
    "createdByEmail" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt"   TIMESTAMP(3),

    CONSTRAINT "ProcessRateContract_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcessRateContract_partyId_status_idx" ON "ProcessRateContract"("partyId", "status");

-- Partial unique index: a party may have at most ONE active contract at a time.
-- Superseded/cancelled versions are excluded so history is retained and a new
-- version can be created without colliding with the old one. (Prisma can't
-- express partial indexes — kept in raw SQL, mirroring the BatchMaking pattern.)
CREATE UNIQUE INDEX "ProcessRateContract_active_party_uniq"
    ON "ProcessRateContract"("partyId")
    WHERE "status" = 'active';

-- CreateTable: ProcessRateLine (one row per process type in a contract)
CREATE TABLE "ProcessRateLine" (
    "id"            SERIAL NOT NULL,
    "contractId"    INTEGER NOT NULL,
    "processTypeId" INTEGER NOT NULL,
    "unit"          TEXT   NOT NULL DEFAULT 'kg', -- per kg | mtr | than
    "rate"          DECIMAL(16,2),               -- FLAT mode
    "rateLight"     DECIMAL(16,2),               -- BY_COLOR_CATEGORY mode
    "rateMedium"    DECIMAL(16,2),
    "rateDark"      DECIMAL(16,2),

    CONSTRAINT "ProcessRateLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessRateLine_contractId_processTypeId_key"
    ON "ProcessRateLine"("contractId", "processTypeId");

-- AlterTable: GreyEntry — link each lot to the contract + process type it was booked under
ALTER TABLE "GreyEntry" ADD COLUMN "processRateContractId" INTEGER;
ALTER TABLE "GreyEntry" ADD COLUMN "processTypeId" INTEGER;

-- AddForeignKey
ALTER TABLE "ProcessRateContract"
    ADD CONSTRAINT "ProcessRateContract_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProcessRateLine"
    ADD CONSTRAINT "ProcessRateLine_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "ProcessRateContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcessRateLine"
    ADD CONSTRAINT "ProcessRateLine_processTypeId_fkey"
    FOREIGN KEY ("processTypeId") REFERENCES "ProcessType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GreyEntry"
    ADD CONSTRAINT "GreyEntry_processRateContractId_fkey"
    FOREIGN KEY ("processRateContractId") REFERENCES "ProcessRateContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GreyEntry"
    ADD CONSTRAINT "GreyEntry_processTypeId_fkey"
    FOREIGN KEY ("processTypeId") REFERENCES "ProcessType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the three known process types (reference data — idempotent on re-run).
INSERT INTO "ProcessType" ("code", "name", "rateMode", "sortOrder") VALUES
    ('HEATSET',         'Heat Set',                 'FLAT',              10),
    ('DYEING_FLAT',     'Dyeing (all colours)',     'FLAT',              20),
    ('DYEING_BY_COLOR', 'Dyeing (Light/Med/Dark)',  'BY_COLOR_CATEGORY', 30)
ON CONFLICT ("code") DO NOTHING;
