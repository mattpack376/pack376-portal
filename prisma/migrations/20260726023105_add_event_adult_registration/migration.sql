-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "adultFeeCents" INTEGER;

-- CreateTable
CREATE TABLE "EventAdultRegistration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountOwedCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByUserId" TEXT,

    CONSTRAINT "EventAdultRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAdultPayment" (
    "id" TEXT NOT NULL,
    "eventAdultRegistrationId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,

    CONSTRAINT "EventAdultPayment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EventAdultRegistration" ADD CONSTRAINT "EventAdultRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAdultRegistration" ADD CONSTRAINT "EventAdultRegistration_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAdultPayment" ADD CONSTRAINT "EventAdultPayment_eventAdultRegistrationId_fkey" FOREIGN KEY ("eventAdultRegistrationId") REFERENCES "EventAdultRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAdultPayment" ADD CONSTRAINT "EventAdultPayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
