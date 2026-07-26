/*
  Warnings:

  - You are about to drop the `EventAdultPayment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EventAdultRegistration` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "EventAdultPayment" DROP CONSTRAINT "EventAdultPayment_eventAdultRegistrationId_fkey";

-- DropForeignKey
ALTER TABLE "EventAdultPayment" DROP CONSTRAINT "EventAdultPayment_recordedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "EventAdultRegistration" DROP CONSTRAINT "EventAdultRegistration_addedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "EventAdultRegistration" DROP CONSTRAINT "EventAdultRegistration_eventId_fkey";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "guestChildFeeCents" INTEGER;

-- DropTable
DROP TABLE "EventAdultPayment";

-- DropTable
DROP TABLE "EventAdultRegistration";

-- CreateTable
CREATE TABLE "EventGuestGroup" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "adultCount" INTEGER NOT NULL DEFAULT 0,
    "childCount" INTEGER NOT NULL DEFAULT 0,
    "amountOwedCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByUserId" TEXT,

    CONSTRAINT "EventGuestGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventGuestGroupPayment" (
    "id" TEXT NOT NULL,
    "eventGuestGroupId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,

    CONSTRAINT "EventGuestGroupPayment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EventGuestGroup" ADD CONSTRAINT "EventGuestGroup_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGuestGroup" ADD CONSTRAINT "EventGuestGroup_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGuestGroupPayment" ADD CONSTRAINT "EventGuestGroupPayment_eventGuestGroupId_fkey" FOREIGN KEY ("eventGuestGroupId") REFERENCES "EventGuestGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGuestGroupPayment" ADD CONSTRAINT "EventGuestGroupPayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
