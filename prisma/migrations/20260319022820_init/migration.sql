-- CreateTable
CREATE TABLE "Party" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Weaver" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Weaver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quality" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transport" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GreyEntry" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "challanNo" INTEGER NOT NULL,
    "partyId" INTEGER NOT NULL,
    "qualityId" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION,
    "than" INTEGER NOT NULL,
    "grayMtr" DOUBLE PRECISION,
    "transportId" INTEGER NOT NULL,
    "transportLrNo" TEXT,
    "bale" INTEGER,
    "baleNo" TEXT,
    "echBaleThan" DOUBLE PRECISION,
    "weaverId" INTEGER NOT NULL,
    "viverNameBill" TEXT,
    "lrNo" TEXT,
    "lotNo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GreyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DespatchEntry" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "challanNo" INTEGER NOT NULL,
    "partyId" INTEGER NOT NULL,
    "qualityId" INTEGER NOT NULL,
    "grayInwDate" TIMESTAMP(3),
    "lotNo" TEXT NOT NULL,
    "jobDelivery" TEXT,
    "than" INTEGER NOT NULL,
    "billNo" TEXT,
    "rate" DOUBLE PRECISION,
    "pTotal" DOUBLE PRECISION,
    "lrNo" TEXT,
    "transportId" INTEGER NOT NULL,
    "bale" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DespatchEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Party_name_key" ON "Party"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Weaver_name_key" ON "Weaver"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Quality_name_key" ON "Quality"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Transport_name_key" ON "Transport"("name");

-- AddForeignKey
ALTER TABLE "GreyEntry" ADD CONSTRAINT "GreyEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GreyEntry" ADD CONSTRAINT "GreyEntry_qualityId_fkey" FOREIGN KEY ("qualityId") REFERENCES "Quality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GreyEntry" ADD CONSTRAINT "GreyEntry_transportId_fkey" FOREIGN KEY ("transportId") REFERENCES "Transport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GreyEntry" ADD CONSTRAINT "GreyEntry_weaverId_fkey" FOREIGN KEY ("weaverId") REFERENCES "Weaver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespatchEntry" ADD CONSTRAINT "DespatchEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespatchEntry" ADD CONSTRAINT "DespatchEntry_qualityId_fkey" FOREIGN KEY ("qualityId") REFERENCES "Quality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespatchEntry" ADD CONSTRAINT "DespatchEntry_transportId_fkey" FOREIGN KEY ("transportId") REFERENCES "Transport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
