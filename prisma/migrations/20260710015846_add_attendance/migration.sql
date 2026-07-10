-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'NO_MEETING');

-- CreateTable
CREATE TABLE "MeetingDate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "MeetingDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "meetingDateId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingDate_date_key" ON "MeetingDate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_scoutId_meetingDateId_key" ON "Attendance"("scoutId", "meetingDateId");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_meetingDateId_fkey" FOREIGN KEY ("meetingDateId") REFERENCES "MeetingDate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
