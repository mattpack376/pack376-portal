import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_ATTENDANCE_LOCK_RULE,
  isValidAttendanceLockRule,
  type AttendanceLockRule,
} from "@/lib/attendanceLock";

/**
 * The saved lock time (AttendanceLockSetting), or the default — 9 PM the day
 * after the meeting — when the master admin hasn't saved one. Cached per
 * request, so a page and its components share one read.
 */
export const getAttendanceLockRule = cache(async (): Promise<AttendanceLockRule> => {
  const row = await prisma.attendanceLockSetting.findUnique({
    where: { id: "main" },
    select: { daysAfter: true, minuteOfDay: true },
  });
  if (!row) return DEFAULT_ATTENDANCE_LOCK_RULE;
  // The table's CHECKs already hold these in range; this only guards a hand edit gone wrong.
  return isValidAttendanceLockRule(row) ? row : DEFAULT_ATTENDANCE_LOCK_RULE;
});
