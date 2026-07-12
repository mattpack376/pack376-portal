-- AlterTable
ALTER TABLE "AdvancementRecord" ADD COLUMN     "updatedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "updatedByUserId" TEXT;

-- AlterTable
ALTER TABLE "DuesPayment" ADD COLUMN     "recordedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "AdvancementRecord" ADD CONSTRAINT "AdvancementRecord_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesPayment" ADD CONSTRAINT "DuesPayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
