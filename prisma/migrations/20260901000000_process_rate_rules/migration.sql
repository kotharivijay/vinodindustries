-- Contract-defined rate rules. The billing adjustments a party's contract
-- carries (batch-size surcharges, Jet-1 discount, 44" width extra, TP Selai +
-- Checking, chemicals, Direct Balotra LR…) previously lived only as prose in
-- ProcessRateContract.notes and were applied from memory at billing time.
-- They are now data: one row per rule, evaluated by lib/process-rate-rules.ts
-- on the /delivery/[id] billing view.

-- CreateTable: ProcessRateRule
CREATE TABLE "ProcessRateRule" (
    "id"            SERIAL        NOT NULL,
    "contractId"    INTEGER       NOT NULL,
    "processTypeId" INTEGER,                       -- null = every line in the contract
    "trigger"       TEXT          NOT NULL DEFAULT 'auto', -- auto | lr | manual
    "minThan"       INTEGER,                       -- dyeing-batch total >= this
    "maxThan"       INTEGER,                       -- dyeing-batch total <= this
    "widthInch"     INTEGER,                       -- quality width equals this
    "machineNumber" INTEGER,                       -- DyeingMachine.number equals this
    "amountPerThan" DECIMAL(16,2) NOT NULL,        -- signed, per than
    "label"         TEXT          NOT NULL,
    "active"        BOOLEAN       NOT NULL DEFAULT true,
    "sortOrder"     INTEGER       NOT NULL DEFAULT 0,

    CONSTRAINT "ProcessRateRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcessRateRule_contractId_idx" ON "ProcessRateRule"("contractId");

-- CreateTable: ChallanLineRuleTick (manual rules accounts ticked, per line —
-- makes the bill total reproducible on reopen)
CREATE TABLE "ChallanLineRuleTick" (
    "id"     SERIAL  NOT NULL,
    "lineId" INTEGER NOT NULL,
    "ruleId" INTEGER NOT NULL,

    CONSTRAINT "ChallanLineRuleTick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChallanLineRuleTick_lineId_ruleId_key" ON "ChallanLineRuleTick"("lineId", "ruleId");

-- AlterTable: Quality gains a real width column (billing rules key off it;
-- the free-text name is untrustworthy — two grammars, and the masters API
-- strips the inch mark on save). Seeded by a reviewed backfill.
ALTER TABLE "Quality" ADD COLUMN "widthInch" INTEGER;

-- AddForeignKey
ALTER TABLE "ProcessRateRule"
    ADD CONSTRAINT "ProcessRateRule_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "ProcessRateContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcessRateRule"
    ADD CONSTRAINT "ProcessRateRule_processTypeId_fkey"
    FOREIGN KEY ("processTypeId") REFERENCES "ProcessType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChallanLineRuleTick"
    ADD CONSTRAINT "ChallanLineRuleTick_lineId_fkey"
    FOREIGN KEY ("lineId") REFERENCES "FinishDeliveryChallanLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChallanLineRuleTick"
    ADD CONSTRAINT "ChallanLineRuleTick_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "ProcessRateRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
