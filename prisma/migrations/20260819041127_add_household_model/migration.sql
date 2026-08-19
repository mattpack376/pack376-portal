-- AlterTable
ALTER TABLE "Scout" ADD COLUMN     "householdId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "householdId" TEXT;

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scout_householdId_idx" ON "Scout"("householdId");

-- CreateIndex
CREATE INDEX "User_householdId_idx" ON "User"("householdId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scout" ADD CONSTRAINT "Scout_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;
