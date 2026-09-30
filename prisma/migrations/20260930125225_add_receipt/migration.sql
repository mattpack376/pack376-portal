-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "receivedFrom" TEXT NOT NULL,
    "scoutName" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL,
    "season" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER NOT NULL,
    "receiptDate" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'FULL',
    "issuedByName" TEXT NOT NULL,
    "issuedByTitle" TEXT NOT NULL DEFAULT '',
    "emailedTo" TEXT,
    "emailedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Receipt_createdAt_idx" ON "Receipt"("createdAt");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
