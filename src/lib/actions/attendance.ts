"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  assertAttendanceAccess,
  assertAttendanceDenAccess,
  assertMasterAdmin,
  canResetDenAttendance,
} from "@/lib/authorize";
import { denDisplayName } from "@/lib/rankConfig";
import { recordAudit, auditDate, EMPTY } from "@/lib/audit";
import { attendanceLockedFor, meetingIsSchedulable, meetingLabel } from "@/lib/attendanceData";
import {
  ATTENDANCE_LOCKED_MESSAGE,
  MAX_LOCK_DAYS_AFTER,
  attendanceLockRuleLabel,
  isValidAttendanceLockRule,
  parseLockTimeInput,
} from "@/lib/attendanceLock";
import { getAttendanceLockRule } from "@/lib/attendanceLockSetting";
import { MEETING_LABEL_MAX_LENGTH } from "@/lib/meetingLabel";

export async function setAttendanceAction(scoutId: string, meetingDateId: string, present: boolean) {
  const session = await getSession();
  if (!session) return { ok: false as const };

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { denId: true, firstName: true, lastName: true, active: true },
  });
  if (!scout) return { ok: false as const };

  try {
    assertAttendanceDenAccess(session, scout.denId);
  } catch {
    return { ok: false as const };
  }

  if (await attendanceLockedFor(session.role, meetingDateId)) {
    return { ok: false as const, error: ATTENDANCE_LOCKED_MESSAGE };
  }

  if (!(await meetingIsSchedulable(meetingDateId))) {
    return { ok: false as const, error: "This meeting has been cancelled." };
  }

  const before = await prisma.attendance.findUnique({
    where: { scoutId_meetingDateId: { scoutId, meetingDateId } },
    select: { present: true },
  });

  // An inactive scout only still appears on the meetings they were already
  // marked for (see scoutsListedForMeeting) — never start a new record for them.
  if (!scout.active && !before) {
    return { ok: false as const, error: `${scout.firstName} ${scout.lastName} is inactive.` };
  }

  await prisma.attendance.upsert({
    where: { scoutId_meetingDateId: { scoutId, meetingDateId } },
    update: { present, updatedByUserId: session.userId },
    create: { scoutId, meetingDateId, present, updatedByUserId: session.userId },
  });

  const wasPresent = before?.present;
  // Re-clicking the same state is a no-op worth staying out of the log.
  if (wasPresent !== present) {
    await recordAudit(session, {
      action: "attendance.set",
      summary: `Marked ${scout.firstName} ${scout.lastName} ${present ? "present" : "absent"} for the ${await meetingLabel(meetingDateId)} meeting`,
      entityType: "Attendance",
      entityId: scoutId,
      denId: scout.denId,
      details: [
        {
          label: "Attendance",
          from: before === null ? EMPTY : wasPresent ? "Present" : "Absent",
          to: present ? "Present" : "Absent",
        },
      ],
    });
  }

  revalidatePath("/portal/den/attendance");
  revalidatePath(`/portal/den/attendance/${meetingDateId}`);
  revalidatePath(`/portal/admin/attendance/${meetingDateId}`);
  return { ok: true as const };
}

export async function markDenPresentAction(denId: string, meetingDateId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const };

  try {
    assertAttendanceDenAccess(session, denId);
  } catch {
    return { ok: false as const };
  }

  if (await attendanceLockedFor(session.role, meetingDateId)) {
    return { ok: false as const, error: ATTENDANCE_LOCKED_MESSAGE };
  }

  if (!(await meetingIsSchedulable(meetingDateId))) {
    return { ok: false as const, error: "This meeting has been cancelled." };
  }

  // Active scouts only: an inactive scout's old marks are left as they were.
  const scouts = await prisma.scout.findMany({ where: { denId, active: true }, select: { id: true } });
  await prisma.$transaction(
    scouts.map((scout) =>
      prisma.attendance.upsert({
        where: { scoutId_meetingDateId: { scoutId: scout.id, meetingDateId } },
        update: { present: true, updatedByUserId: session.userId },
        create: { scoutId: scout.id, meetingDateId, present: true, updatedByUserId: session.userId },
      })
    )
  );

  // Logged as one entry rather than one per scout: it was one click, and the
  // per-scout rows would bury everything else in the log for that meeting.
  const den = await prisma.den.findUnique({ where: { id: denId }, select: { rank: true, scoutingYear: true, label: true } });
  await recordAudit(session, {
    action: "attendance.markDenPresent",
    summary: `Marked all ${scouts.length} scout${scouts.length === 1 ? "" : "s"} in ${
      den ? denDisplayName(den.rank, den.scoutingYear, den.label) : "the den"
    } present for the ${await meetingLabel(meetingDateId)} meeting`,
    entityType: "Den",
    entityId: denId,
    denId,
  });

  revalidatePath("/portal/den/attendance");
  revalidatePath(`/portal/den/attendance/${meetingDateId}`);
  revalidatePath(`/portal/admin/attendance/${meetingDateId}`);
  return { ok: true as const };
}

/** Admin, Junior Admin or Committee Member only — clears every attendance mark for one den on one meeting date. */
export async function resetDenAttendanceAction(denId: string, meetingDateId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const };
  if (!canResetDenAttendance(session)) {
    return { ok: false as const };
  }

  if (await attendanceLockedFor(session.role, meetingDateId)) {
    return { ok: false as const, error: ATTENDANCE_LOCKED_MESSAGE };
  }

  const { count } = await prisma.attendance.deleteMany({
    where: { meetingDateId, scout: { denId } },
  });

  const den = await prisma.den.findUnique({ where: { id: denId }, select: { rank: true, scoutingYear: true, label: true } });
  await recordAudit(session, {
    action: "attendance.resetDen",
    summary: `Cleared ${count} attendance mark${count === 1 ? "" : "s"} for ${
      den ? denDisplayName(den.rank, den.scoutingYear, den.label) : "a den"
    } on the ${await meetingLabel(meetingDateId)} meeting`,
    entityType: "Den",
    entityId: denId,
    denId,
  });

  revalidatePath("/portal/den/attendance");
  revalidatePath(`/portal/den/attendance/${meetingDateId}`);
  revalidatePath(`/portal/admin/attendance/${meetingDateId}`);
  return { ok: true as const };
}

export async function setMeetingStatusAction(meetingDateId: string, status: "SCHEDULED" | "NO_MEETING") {
  const session = await getSession();
  if (!session) return { ok: false as const };
  try {
    assertAttendanceAccess(session);
  } catch {
    return { ok: false as const };
  }

  if (await attendanceLockedFor(session.role, meetingDateId)) {
    return { ok: false as const, error: ATTENDANCE_LOCKED_MESSAGE };
  }

  const before = await prisma.meetingDate.findUnique({ where: { id: meetingDateId }, select: { status: true, date: true } });

  await prisma.meetingDate.update({ where: { id: meetingDateId }, data: { status } });

  if (before && before.status !== status) {
    const label = auditDate(before.date);
    await recordAudit(session, {
      action: "attendance.meetingStatus",
      summary:
        status === "NO_MEETING"
          ? `Cancelled the ${label} meeting`
          : `Restored the ${label} meeting to scheduled`,
      entityType: "MeetingDate",
      entityId: meetingDateId,
      details: [
        {
          label: "Status",
          from: before.status === "NO_MEETING" ? "No meeting" : "Scheduled",
          to: status === "NO_MEETING" ? "No meeting" : "Scheduled",
        },
      ],
    });
  }

  revalidatePath("/portal/den/attendance");
  revalidatePath(`/portal/den/attendance/${meetingDateId}`);
  revalidatePath("/portal/admin/attendance");
  revalidatePath(`/portal/admin/attendance/${meetingDateId}`);
  // Leaders & committee share the same meeting calendar, so a cancellation lands there too.
  revalidatePath("/portal/admin/attendance/leaders");
  revalidatePath(`/portal/admin/attendance/leaders/${meetingDateId}`);
  // The public calendar drops the regular meeting on a cancelled Friday (getPublicCalendar).
  revalidatePath("/calendar");
  return { ok: true as const };
}

/**
 * Sets (or, left blank, clears) the label shown beside a meeting date, e.g.
 * "Camp Conron". Throws on failure like every other Save-button action, so
 * the "Saved ✓" toast only ever follows a save that went through.
 */
export async function setMeetingLabelAction(meetingDateId: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  assertAttendanceAccess(session);
  if (await attendanceLockedFor(session.role, meetingDateId)) throw new Error(ATTENDANCE_LOCKED_MESSAGE);

  const label = String(formData.get("label") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEETING_LABEL_MAX_LENGTH);
  const next = label === "" ? null : label;

  const before = await prisma.meetingDate.findUnique({ where: { id: meetingDateId }, select: { label: true, date: true } });
  if (!before) throw new Error("Meeting not found.");

  await prisma.meetingDate.update({ where: { id: meetingDateId }, data: { label: next } });

  if (before.label !== next) {
    const date = auditDate(before.date);
    await recordAudit(session, {
      action: "attendance.meetingLabel",
      summary: next === null ? `Removed the label from the ${date} meeting` : `Labeled the ${date} meeting "${next}"`,
      entityType: "MeetingDate",
      entityId: meetingDateId,
      details: [{ label: "Label", from: before.label ?? EMPTY, to: next ?? EMPTY }],
    });
  }

  // Every attendance list shows the label, and den leaders' lists are the same data.
  revalidatePath("/portal/den/attendance");
  revalidatePath(`/portal/den/attendance/${meetingDateId}`);
  revalidatePath("/portal/admin/attendance");
  revalidatePath(`/portal/admin/attendance/${meetingDateId}`);
  revalidatePath("/portal/admin/attendance/leaders");
  revalidatePath(`/portal/admin/attendance/leaders/${meetingDateId}`);
}

/**
 * When attendance locks after a meeting — master admin only. Takes effect at
 * once for every meeting, past ones included: a later lock time can reopen a
 * meeting that had already locked for non-Admins.
 */
export async function updateAttendanceLockRuleAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  await assertMasterAdmin(session);

  const daysRaw = String(formData.get("daysAfter") ?? "").trim();
  const daysAfter = /^\d+$/.test(daysRaw) ? Number(daysRaw) : NaN;
  const minuteOfDay = parseLockTimeInput(String(formData.get("lockTime") ?? ""));
  if (minuteOfDay === null) throw new Error("Enter the time attendance should lock.");
  const rule = { daysAfter, minuteOfDay };
  if (!isValidAttendanceLockRule(rule)) {
    throw new Error(`Pick a lock day from the meeting day up to ${MAX_LOCK_DAYS_AFTER} days after.`);
  }

  const before = await getAttendanceLockRule();
  await prisma.attendanceLockSetting.upsert({
    where: { id: "main" },
    create: { id: "main", daysAfter, minuteOfDay },
    update: { daysAfter, minuteOfDay },
  });

  if (before.daysAfter !== daysAfter || before.minuteOfDay !== minuteOfDay) {
    await recordAudit(session, {
      action: "attendance.lockRule",
      summary: `Changed when attendance locks to ${attendanceLockRuleLabel(rule)}`,
      entityType: "AttendanceLockSetting",
      entityId: "main",
      details: [{ label: "Locks at", from: attendanceLockRuleLabel(before), to: attendanceLockRuleLabel(rule) }],
    });
  }

  revalidatePath("/portal/admin/attendance", "layout");
  revalidatePath("/portal/den/attendance", "layout");
}
