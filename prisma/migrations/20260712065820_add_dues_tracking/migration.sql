-- CreateTable
CREATE TABLE "DuesSettings" (
    "id" TEXT NOT NULL,
    "scoutingYear" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuesSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuesPayment" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuesPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DuesSettings_scoutingYear_key" ON "DuesSettings"("scoutingYear");

-- AddForeignKey
ALTER TABLE "DuesPayment" ADD CONSTRAINT "DuesPayment_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
