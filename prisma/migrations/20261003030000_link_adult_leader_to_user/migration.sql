-- AlterTable
ALTER TABLE "AdultLeader" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AdultLeader_userId_key" ON "AdultLeader"("userId");

-- AddForeignKey
ALTER TABLE "AdultLeader" ADD CONSTRAINT "AdultLeader_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

