-- CreateEnum
CREATE TYPE "AdultLeaderSection" AS ENUM ('COMMITTEE', 'LEADERS');

-- CreateTable
CREATE TABLE "AdultLeader" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "positions" TEXT[],
    "section" "AdultLeaderSection" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdultLeader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdultLeaderAttendance" (
    "id" TEXT NOT NULL,
    "adultLeaderId" TEXT NOT NULL,
    "meetingDateId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "AdultLeaderAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdultLeaderAttendance_adultLeaderId_meetingDateId_key" ON "AdultLeaderAttendance"("adultLeaderId", "meetingDateId");

-- AddForeignKey
ALTER TABLE "AdultLeaderAttendance" ADD CONSTRAINT "AdultLeaderAttendance_adultLeaderId_fkey" FOREIGN KEY ("adultLeaderId") REFERENCES "AdultLeader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdultLeaderAttendance" ADD CONSTRAINT "AdultLeaderAttendance_meetingDateId_fkey" FOREIGN KEY ("meetingDateId") REFERENCES "MeetingDate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdultLeaderAttendance" ADD CONSTRAINT "AdultLeaderAttendance_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the 2026–2027 committee and leader list. One row per person, not per
-- position: someone holding two positions (Dianaliz, Howell, Christopher) gets
-- one attendance mark per meeting with both positions listed, filed under the
-- section of the first one. Tiger Den Leader is vacant, so it has no row yet —
-- add whoever fills it from Attendance → Leaders & Committee → Manage List.
INSERT INTO "AdultLeader" ("id", "name", "positions", "section", "sortOrder", "createdAt", "updatedAt") VALUES
  ('adlt-seed-01', 'Matt Rosen', ARRAY['Committee Chair'], 'COMMITTEE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-02', 'Patricia Marotta', ARRAY['Council Unit Rep'], 'COMMITTEE', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-03', 'Dianaliz Almonte', ARRAY['Treasurer', 'Wolf Den Leader'], 'COMMITTEE', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-04', 'Christina Ferrara', ARRAY['Activities Coordinator/Social Media'], 'COMMITTEE', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-05', 'Louie G Tala', ARRAY['Committee Member'], 'COMMITTEE', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-06', 'Howell Woods', ARRAY['Cubmaster', 'Arrow of Light Den Leader'], 'LEADERS', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-07', 'Christopher LaRosa', ARRAY['Assistant Cubmaster', 'Webelos Den Leader'], 'LEADERS', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-08', 'Nicole Scivioli', ARRAY['Lion Den Leader'], 'LEADERS', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-09', 'Skylar Moeller', ARRAY['Bear Den Leader'], 'LEADERS', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('adlt-seed-10', 'Carmine Mancini', ARRAY['Webelos Assistant Den Leader'], 'LEADERS', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
