-- CreateTable
CREATE TABLE "DenAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "denId" TEXT NOT NULL,

    CONSTRAINT "DenAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DenAssignment_userId_denId_key" ON "DenAssignment"("userId", "denId");

-- AddForeignKey
ALTER TABLE "DenAssignment" ADD CONSTRAINT "DenAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DenAssignment" ADD CONSTRAINT "DenAssignment_denId_fkey" FOREIGN KEY ("denId") REFERENCES "Den"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every existing shared den login's single denId into the new join
-- table before the column is dropped, so no account loses its den access.
INSERT INTO "DenAssignment" ("id", "userId", "denId")
SELECT gen_random_uuid()::text, "id", "denId" FROM "User" WHERE "denId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_denId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "denId";
