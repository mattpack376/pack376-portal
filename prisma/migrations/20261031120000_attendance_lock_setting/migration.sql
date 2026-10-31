-- When attendance locks after a meeting, set by the master admin on the
-- Attendance tab. A brand-new, empty table, so the checks can't trip on old
-- rows. With no row the app uses its default: 9 PM the day after the meeting.
CREATE TABLE "AttendanceLockSetting" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "daysAfter" INTEGER NOT NULL DEFAULT 1,
    "minuteOfDay" INTEGER NOT NULL DEFAULT 1260,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceLockSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AttendanceLockSetting_daysAfter_check" CHECK ("daysAfter" BETWEEN 0 AND 7),
    CONSTRAINT "AttendanceLockSetting_minuteOfDay_check" CHECK ("minuteOfDay" BETWEEN 0 AND 1439)
);
