-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RafflePaymentMethod" AS ENUM ('CASH', 'ZELLE', 'CHECK', 'OTHER');

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "drawingDate" DATE,
    "boxCount" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "prizePercent" INTEGER NOT NULL DEFAULT 50,
    "status" "RaffleStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "winningBox" INTEGER,
    "winnerName" TEXT,
    "prizeCents" INTEGER,
    "prizePaid" BOOLEAN NOT NULL DEFAULT false,
    "prizePaidOn" DATE,
    "prizePaidMethod" "RafflePaymentMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleEntry" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleBox" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,

    CONSTRAINT "RaffleBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RafflePayment" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "entryId" TEXT,
    "method" "RafflePaymentMethod" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "payerName" TEXT,
    "receivedOn" DATE,
    "note" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByName" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByName" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,

    CONSTRAINT "RafflePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Raffle_status_drawingDate_idx" ON "Raffle"("status", "drawingDate");

-- CreateIndex
CREATE INDEX "RaffleEntry_raffleId_idx" ON "RaffleEntry"("raffleId");

-- CreateIndex
CREATE INDEX "RaffleBox_entryId_idx" ON "RaffleBox"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "RaffleBox_raffleId_number_key" ON "RaffleBox"("raffleId", "number");

-- CreateIndex
CREATE INDEX "RafflePayment_raffleId_idx" ON "RafflePayment"("raffleId");

-- CreateIndex
CREATE INDEX "RafflePayment_entryId_idx" ON "RafflePayment"("entryId");

-- AddForeignKey
ALTER TABLE "RaffleEntry" ADD CONSTRAINT "RaffleEntry_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleBox" ADD CONSTRAINT "RaffleBox_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleBox" ADD CONSTRAINT "RaffleBox_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "RaffleEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RafflePayment" ADD CONSTRAINT "RafflePayment_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RafflePayment" ADD CONSTRAINT "RafflePayment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "RaffleEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RafflePayment" ADD CONSTRAINT "RafflePayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
