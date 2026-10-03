-- AlterTable
ALTER TABLE "MeetingDate" ADD COLUMN "label" TEXT;

-- The two labels that were hard-coded before they became editable: the Camp
-- Conron departure Friday and the Halloween Pack Night. Upserted rather than
-- updated so they stick even if the attendance pages haven't created that
-- Friday's row yet (ensureMeetingDates skips dates that already exist).
INSERT INTO "MeetingDate" ("id", "date", "status", "label")
VALUES
  (gen_random_uuid()::text, DATE '2026-10-09', 'SCHEDULED', 'Camp Conron'),
  (gen_random_uuid()::text, DATE '2026-10-30', 'SCHEDULED', 'Halloween Pack Night')
ON CONFLICT ("date") DO UPDATE SET "label" = EXCLUDED."label";
