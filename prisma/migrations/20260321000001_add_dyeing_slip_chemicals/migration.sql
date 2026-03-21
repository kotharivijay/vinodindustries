-- AlterTable: add notes to DyeingEntry
ALTER TABLE "DyeingEntry" ADD COLUMN "notes" TEXT;

-- CreateTable: DyeingSlipChemical
CREATE TABLE "DyeingSlipChemical" (
    "id"         SERIAL NOT NULL,
    "entryId"    INTEGER NOT NULL,
    "chemicalId" INTEGER,
    "name"       TEXT NOT NULL,
    "quantity"   DOUBLE PRECISION,
    "unit"       TEXT NOT NULL DEFAULT 'kg',
    "rate"       DOUBLE PRECISION,
    "cost"       DOUBLE PRECISION,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DyeingSlipChemical_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: DyeingSlipChemical → DyeingEntry
ALTER TABLE "DyeingSlipChemical"
    ADD CONSTRAINT "DyeingSlipChemical_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "DyeingEntry"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DyeingSlipChemical → Chemical (optional)
ALTER TABLE "DyeingSlipChemical"
    ADD CONSTRAINT "DyeingSlipChemical_chemicalId_fkey"
    FOREIGN KEY ("chemicalId") REFERENCES "Chemical"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
