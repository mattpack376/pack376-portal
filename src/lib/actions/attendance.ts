"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAttendanceAccess, assertAttendanceDenAccess } from "@/lib/authorize";
import { denDisplayName } from "@/lib/rankConfig";
import { recordAudit, auditDate, EMPTY } from "@/lib/audit";

async function assertMeetingIsSchedulable(meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId }, select: { status: true } });
  return !!meeting && meeting.status === "SCHEDULED";
}

/** The meeting's date as audit text; falls back to the id if the row vanished mid-request. */
async function meetingLabel(meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId }, select: { date: true } });
  return meeting ? auditDate(meeting.date) : meetingDateId;
}

export async function setAttendanceAction(scoutId: string, meetingDateId: string, present: boolean) {
  const session = await getSession();
  if (!session) return { ok: false as const };

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { denId: true, firstName: true, lastName: true },
  });
  if (!scout) return { ok: false as const };

  try {
    assertAttendanceDenAccess(session, scout.denId);
  } catch {
    return { ok: false as const };
  }

  if (!(await assertMeetingIsSchedulable(meetingDateId))) {
    return { ok: false as const, error: "This meeting has been cancelled." };
  }

  const before = await prisma.attendance.findUnique({
    where: { scoutId_meetingDateId: { scoutId, meetingDateId } },
    select: { present: true },
  });

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

  if (!(await assertMeetingIsSchedulable(meetingDateId))) {
    return { ok: false as const, error: "This meeting has been cancelled." };
  }

  const scouts = await prisma.scout.findMany({ where: { denId }, select: { id: true } });
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

/** Full admin or junior admin only — clears every attendance mark for one den on one meeting date. */
export async function resetDenAttendanceAction(denId: string, meetingDateId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const };
  if (session.role !== "ADMIN" && session.role !== "JUNIOR_ADMIN") {
    return { ok: false as const };
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
  return { ok: true as const };
}
