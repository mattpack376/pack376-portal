-- AlterTable
ALTER TABLE "EventGuestGroup" ADD COLUMN     "guestOfScoutId" TEXT,
ADD COLUMN     "guestOfUserId" TEXT;

-- AddForeignKey
ALTER TABLE "EventGuestGroup" ADD CONSTRAINT "EventGuestGroup_guestOfScoutId_fkey" FOREIGN KEY ("guestOfScoutId") REFERENCES "Scout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGuestGroup" ADD CONSTRAINT "EventGuestGroup_guestOfUserId_fkey" FOREIGN KEY ("guestOfUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
