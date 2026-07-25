-- CreateTable
CREATE TABLE "HomepageEvent" (
    "id" TEXT NOT NULL,
    "dateLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageEvent_pkey" PRIMARY KEY ("id")
);

-- Seed the events that were previously hardcoded on the homepage, so this
-- migration carries them into the new admin-editable table instead of
-- silently dropping them when the static list is removed from page.tsx.
INSERT INTO "HomepageEvent" ("id", "dateLabel", "title", "description", "sortDate", "createdAt", "updatedAt") VALUES
  ('hpevt-seed-01', 'Sep 11', 'Scout Registration Night — Parents Only (No Scouts)', 'Cubmaster and Committee Chair review the scouting season ahead with parents, discuss parent obligations, and cover other important details for a successful scouting year.', '2026-09-11', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-02', 'Sep 18', 'Scout Registration Night — Parents Only (No Scouts)', 'Cubmaster and Committee Chair review the scouting season ahead with parents, discuss parent obligations, and cover other important details for a successful scouting year.', '2026-09-18', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-03', 'Sep 25', 'First Scout Meeting', 'Kicking off the 2026–2027 program year. Returning scouts should be in full uniform — new scouts are welcome to join without one.', '2026-09-25', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-04', 'Oct 9–12', 'Camp Conron Weekend', 'Friday through Monday over Columbus Day weekend — four days of camping and Pack 376 adventure.', '2026-10-09', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-05', 'Oct 30', 'Halloween Pack Night', 'Costumes are encouraged. Enjoy games, activities, and Halloween fun with the whole pack.', '2026-10-30', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-06', 'Nov 7 or 8', 'Parish Anniversary Celebration', 'Pack 376 joins Our Lady of Grace in celebrating our chartering organization.', '2026-11-07', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-07', 'Nov 20', 'Pie Night & Bring-a-Friend Night', 'Bring a pie to share and invite a friend to experience Pack 376.', '2026-11-20', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-08', 'Dec 18', '🎅 Holiday Pack Night Celebration 🕎', 'Ring in the season with the whole pack — holiday cheer, treats, and fun for every family and every tradition.', '2026-12-18', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-09', 'Jan 31', 'Klondike Derby', 'A Coney Island favorite in our own backyard.', '2027-01-31', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('hpevt-seed-10', 'Mar 5–6', 'Pinewood Derby Overnight', NULL, '2027-03-05', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
