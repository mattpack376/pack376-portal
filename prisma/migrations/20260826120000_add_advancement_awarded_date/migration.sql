-- Date the badge was actually presented. Independent of completedDate: a
-- leader records the adventure as finished right away and comes back weeks
-- later, after the pack meeting, to fill this in.
ALTER TABLE "AdvancementRecord" ADD COLUMN "awardedDate" DATE;

-- completedDate used to be auto-stamped with the moment the box was checked;
-- it is now a date the leader picks, so narrow it to DATE. Existing rows hold
-- a UTC instant, so convert through the pack's time zone — a plain cast would
-- push every box checked after 8pm Eastern onto the following day.
ALTER TABLE "AdvancementRecord"
  ALTER COLUMN "completedDate" TYPE DATE
  USING (("completedDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date;
