-- CreateEnum
CREATE TYPE "TripAffiliation" AS ENUM ('PACK', 'TROOP');

-- CreateEnum
CREATE TYPE "TripDay" AS ENUM ('FRIDAY', 'SATURDAY', 'SUNDAY', 'MONDAY');

-- CreateEnum
CREATE TYPE "TripMealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER');

-- CreateTable
CREATE TABLE "TripPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "flyerUrl" TEXT,
    "detailsHtml" TEXT,
    "regularPriceCents" INTEGER NOT NULL DEFAULT 0,
    "earlyBirdPriceCents" INTEGER,
    "earlyBirdDeadline" DATE,
    "rsvpDeadline" DATE,
    "freeAgeAndUnder" INTEGER,
    "packPaymentInstructions" TEXT,
    "troopPaymentInstructions" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripRegistration" (
    "id" TEXT NOT NULL,
    "tripPageId" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "affiliation" "TripAffiliation" NOT NULL,
    "payingCount" INTEGER NOT NULL DEFAULT 0,
    "freeCount" INTEGER NOT NULL DEFAULT 0,
    "amountOwedCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPayment" (
    "id" TEXT NOT NULL,
    "tripRegistrationId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,

    CONSTRAINT "TripPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMeal" (
    "id" TEXT NOT NULL,
    "tripPageId" TEXT NOT NULL,
    "day" "TripDay" NOT NULL,
    "mealType" "TripMealType" NOT NULL,
    "menuText" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "TripMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripDutySlot" (
    "id" TEXT NOT NULL,
    "tripPageId" TEXT NOT NULL,
    "tripMealId" TEXT,
    "label" TEXT NOT NULL,
    "assignedName" TEXT,
    "arriveTime" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripDutySlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripPage_slug_key" ON "TripPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TripMeal_tripPageId_day_mealType_key" ON "TripMeal"("tripPageId", "day", "mealType");

-- AddForeignKey
ALTER TABLE "TripRegistration" ADD CONSTRAINT "TripRegistration_tripPageId_fkey" FOREIGN KEY ("tripPageId") REFERENCES "TripPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPayment" ADD CONSTRAINT "TripPayment_tripRegistrationId_fkey" FOREIGN KEY ("tripRegistrationId") REFERENCES "TripRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPayment" ADD CONSTRAINT "TripPayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMeal" ADD CONSTRAINT "TripMeal_tripPageId_fkey" FOREIGN KEY ("tripPageId") REFERENCES "TripPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDutySlot" ADD CONSTRAINT "TripDutySlot_tripPageId_fkey" FOREIGN KEY ("tripPageId") REFERENCES "TripPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripDutySlot" ADD CONSTRAINT "TripDutySlot_tripMealId_fkey" FOREIGN KEY ("tripMealId") REFERENCES "TripMeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
