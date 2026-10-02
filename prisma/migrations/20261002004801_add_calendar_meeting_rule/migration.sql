-- CreateTable
CREATE TABLE "CalendarMeetingRule" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL DEFAULT 'Scout Meeting',
    "detail" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarMeetingRule_pkey" PRIMARY KEY ("id")
);

-- Seed: the regular Friday meeting, running from the first Scout Meeting of the
-- 2026-2027 year through Graduation Night. Edited from the portal after this.
INSERT INTO "CalendarMeetingRule" ("id", "enabled", "title", "detail", "startDate", "endDate", "updatedAt")
VALUES ('main', true, 'Scout Meeting', '7:30 – 9:30 PM', '2026-09-25', '2027-06-18', CURRENT_TIMESTAMP);
