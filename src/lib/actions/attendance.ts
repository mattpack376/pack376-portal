"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAttendanceAccess, assertAttendanceDenAccess } from "@/lib/authorize";

async function assertMeetingIsSchedulable(meetingDateId: string) {
  const meeting = await prisma.meetingDate.findUnique({ where: { id: meetingDateId }, select: { status: true } });
  return !!meeting && meeting.status === "SCHEDULED";
}

export async function setAttendanceAction(scoutId: string, meetingDateId: string, present: boolean) {
  const session = await getSession();
  if (!session) return { ok: false as const };

  const scout = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!scout) return { ok: false as const };

  try {
    assertAttendanceDenAccess(session, scout.denId);
  } catch {
    return { ok: false as const };
  }

  if (!(await assertMeetingIsSchedulable(meetingDateId))) {
    return { ok: false as const, error: "This meeting has been cancelled." };
  }

  await prisma.attendance.upsert({
    where: { scoutId_meetingDateId: { scoutId, meetingDateId } },
    update: { present, updatedByUserId: session.userId },
    create: { scoutId, meetingDateId, present, updatedByUserId: session.userId },
  });

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

  await prisma.meetingDate.update({ where: { id: meetingDateId }, data: { status } });

  revalidatePath("/portal/den/attendance");
  revalidatePath(`/portal/den/attendance/${meetingDateId}`);
  revalidatePath("/portal/admin/attendance");
  revalidatePath(`/portal/admin/attendance/${meetingDateId}`);
  return { ok: true as const };
}
