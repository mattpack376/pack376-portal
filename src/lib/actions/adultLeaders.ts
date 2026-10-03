"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertLeaderAttendanceAccess, canResetLeaderAttendance } from "@/lib/authorize";
import { leadersListedForMeeting } from "@/lib/adultLeaderAttendanceData";
import { meetingIsSchedulable, meetingLabel } from "@/lib/attendanceData";
import { ADULT_LEADER_SECTION_LABELS, formatPositions, isAdultLeaderSection } from "@/lib/adultLeaderSections";
import { recordAudit, changedFields, EMPTY } from "@/lib/audit";
import { formatPhoneNumber } from "@/lib/phone";
import type { AdultLeaderSection } from "@/generated/prisma/enums";

const LEADERS_PATH = "/portal/admin/attendance/leaders";

const MAX_NAME_LENGTH = 100;
const MAX_POSITIONS = 10;
const MAX_POSITION_LENGTH = 100;
const MAX_EMAIL_LENGTH = 200;
const MAX_PHONE_LENGTH = 40;
// Same loose shape check as the trip sign-up form: the browser's type="email"
// does the real prevention, this only stops a malformed address from landing
// in the Email Everyone list, where it would break the whole send.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function revalidateMeeting(meetingDateId: string) {
  revalidatePath(LEADERS_PATH);
  revalidatePath(`${LEADERS_PATH}/${meetingDateId}`);
}

export async function setAdultLeaderAttendanceAction(adultLeaderId: string, meetingDateId: string, present: boolean) {
  const session = await getSession();
  if (!session) return { ok: false as const };
  try {
    assertLeaderAttendanceAccess(session);
  } catch {
    return { ok: false as const };
  }

  const leader = await prisma.adultLeader.findUnique({
    where: { id: adultLeaderId },
    select: { name: true, active: true },
  });
  if (!leader) return { ok: false as const };

  if (!(await meetingIsSchedulable(meetingDateId))) {
    return { ok: false as const, error: "This meeting has been cancelled." };
  }

  const before = await prisma.adultLeaderAttendance.findUnique({
    where: { adultLeaderId_meetingDateId: { adultLeaderId, meetingDateId } },
    select: { present: true },
  });

  // Someone taken off the list only still appears on the meetings they were
  // already marked for (see leadersListedForMeeting) — never start a new
  // record for them anywhere else.
  if (!leader.active && !before) {
    return { ok: false as const, error: `${leader.name} is no longer on the list.` };
  }

  await prisma.adultLeaderAttendance.upsert({
    where: { adultLeaderId_meetingDateId: { adultLeaderId, meetingDateId } },
    update: { present, updatedByUserId: session.userId },
    create: { adultLeaderId, meetingDateId, present, updatedByUserId: session.userId },
  });

  const wasPresent = before?.present;
  // Re-clicking the same state is a no-op worth staying out of the log.
  if (wasPresent !== present) {
    await recordAudit(session, {
      action: "attendance.leader.set",
      summary: `Marked leader ${leader.name} ${present ? "present" : "absent"} for the ${await meetingLabel(meetingDateId)} meeting`,
      entityType: "AdultLeaderAttendance",
      entityId: adultLeaderId,
      details: [
        {
          label: "Attendance",
          from: before === null ? EMPTY : wasPresent ? "Present" : "Absent",
          to: present ? "Present" : "Absent",
        },
      ],
    });
  }

  revalidateMeeting(meetingDateId);
  return { ok: true as const };
}

export async function markAllAdultLeadersPresentAction(meetingDateId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const };
  try {
    assertLeaderAttendanceAccess(session);
  } catch {
    return { ok: false as const };
  }

  if (!(await meetingIsSchedulable(meetingDateId))) {
    return { ok: false as const, error: "This meeting has been cancelled." };
  }

  const leaders = await prisma.adultLeader.findMany({
    where: leadersListedForMeeting(meetingDateId),
    select: { id: true },
  });
  await prisma.$transaction(
    leaders.map((leader) =>
      prisma.adultLeaderAttendance.upsert({
        where: { adultLeaderId_meetingDateId: { adultLeaderId: leader.id, meetingDateId } },
        update: { present: true, updatedByUserId: session.userId },
        create: { adultLeaderId: leader.id, meetingDateId, present: true, updatedByUserId: session.userId },
      })
    )
  );

  // One entry for the one click, same as markDenPresentAction.
  await recordAudit(session, {
    action: "attendance.leader.markAllPresent",
    summary: `Marked everyone on the leader & committee list (${leaders.length}) present for the ${await meetingLabel(meetingDateId)} meeting`,
    entityType: "MeetingDate",
    entityId: meetingDateId,
  });

  revalidateMeeting(meetingDateId);
  return { ok: true as const };
}

/** Admin or Junior Admin — clears every leader & committee mark on one meeting date. */
export async function resetAdultLeaderAttendanceAction(meetingDateId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const };
  if (!canResetLeaderAttendance(session)) {
    return { ok: false as const };
  }

  const { count } = await prisma.adultLeaderAttendance.deleteMany({ where: { meetingDateId } });

  await recordAudit(session, {
    action: "attendance.leader.reset",
    summary: `Cleared ${count} leader & committee attendance mark${count === 1 ? "" : "s"} on the ${await meetingLabel(meetingDateId)} meeting`,
    entityType: "MeetingDate",
    entityId: meetingDateId,
  });

  revalidateMeeting(meetingDateId);
  return { ok: true as const };
}

/*
 * Who's on the list is Admin-only: every roster action below asserts it. The
 * other leader-attendance roles mark people present; they don't decide who's on it.
 */

/**
 * Positions come in as one comma-separated field ("Treasurer, Wolf Den
 * Leader") — none of the pack's position titles contain a comma.
 */
function readLeaderForm(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const positions = [
    ...new Set(
      String(formData.get("positions") || "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    ),
  ];
  const section = String(formData.get("section") || "");
  const email = String(formData.get("email") || "").trim();
  const phone = formatPhoneNumber(String(formData.get("phone") || ""));

  if (!name) throw new Error("Name is required.");
  if (name.length > MAX_NAME_LENGTH) throw new Error(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
  if (positions.length > MAX_POSITIONS || positions.some((p) => p.length > MAX_POSITION_LENGTH)) {
    throw new Error("Too many positions, or one is too long.");
  }
  if (!isAdultLeaderSection(section)) throw new Error("Choose a section.");
  if (email && (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email))) {
    throw new Error("Enter a valid email address.");
  }
  if (phone.length > MAX_PHONE_LENGTH) throw new Error("That phone number is too long.");
  return { name, positions, section, email: email || null, phone: phone || null };
}

async function nextSortOrder(section: AdultLeaderSection) {
  const { _max } = await prisma.adultLeader.aggregate({ where: { section }, _max: { sortOrder: true } });
  return (_max.sortOrder ?? 0) + 1;
}

export async function createAdultLeaderAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const { name, positions, section, email, phone } = readLeaderForm(formData);

  const leader = await prisma.adultLeader.create({
    data: { name, positions, section, email, phone, sortOrder: await nextSortOrder(section) },
  });

  await recordAudit(session, {
    action: "adultLeader.create",
    summary: `Added ${name} to the leader & committee attendance list`,
    entityType: "AdultLeader",
    entityId: leader.id,
    details: [
      { label: "Name", from: EMPTY, to: name },
      { label: "Positions", from: EMPTY, to: formatPositions(positions) || EMPTY },
      { label: "Section", from: EMPTY, to: ADULT_LEADER_SECTION_LABELS[section] },
      ...(email ? [{ label: "Email", from: EMPTY, to: email }] : []),
      ...(phone ? [{ label: "Phone", from: EMPTY, to: phone }] : []),
    ],
  });

  revalidatePath(LEADERS_PATH, "layout");
}

export async function updateAdultLeaderAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing leader id.");
  const { name, positions, section, email, phone } = readLeaderForm(formData);

  const before = await prisma.adultLeader.findUnique({
    where: { id },
    select: { name: true, positions: true, section: true, email: true, phone: true },
  });
  if (!before) throw new Error("That person is no longer on the list.");

  await prisma.adultLeader.update({
    where: { id },
    data: {
      name,
      positions,
      section,
      email,
      phone,
      // Moving sections goes to the end of the new one, same as someone new.
      ...(section !== before.section ? { sortOrder: await nextSortOrder(section) } : {}),
    },
  });

  const details = changedFields({
    Name: [before.name, name],
    Positions: [formatPositions(before.positions), formatPositions(positions)],
    Section: [ADULT_LEADER_SECTION_LABELS[before.section], ADULT_LEADER_SECTION_LABELS[section]],
    Email: [before.email, email],
    Phone: [before.phone, phone],
  });
  if (details.length > 0) {
    await recordAudit(session, {
      action: "adultLeader.update",
      summary: `Edited ${name} on the leader & committee attendance list`,
      entityType: "AdultLeader",
      entityId: id,
      details,
    });
  }

  revalidatePath(LEADERS_PATH, "layout");
}

/**
 * "Remove" takes someone off the list going forward without touching the
 * meetings they were already marked for; "Restore" puts them back.
 */
export async function setAdultLeaderActiveAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const active = String(formData.get("active") || "") === "true";
  if (!id) throw new Error("Missing leader id.");

  const before = await prisma.adultLeader.findUnique({ where: { id }, select: { name: true, active: true } });
  if (!before) throw new Error("That person is no longer on the list.");
  if (before.active === active) return;

  await prisma.adultLeader.update({ where: { id }, data: { active } });

  await recordAudit(session, {
    action: active ? "adultLeader.restore" : "adultLeader.remove",
    summary: active
      ? `Put ${before.name} back on the leader & committee attendance list`
      : `Took ${before.name} off the leader & committee attendance list`,
    entityType: "AdultLeader",
    entityId: id,
    details: [{ label: "On the list", from: before.active ? "Yes" : "No", to: active ? "Yes" : "No" }],
  });

  revalidatePath(LEADERS_PATH, "layout");
}

/** Only for someone already removed — takes their attendance history with them. */
export async function deleteAdultLeaderAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing leader id.");

  const leader = await prisma.adultLeader.findUnique({
    where: { id },
    select: { name: true, active: true, _count: { select: { attendances: true } } },
  });
  if (!leader) throw new Error("That person is no longer on the list.");
  if (leader.active) throw new Error("Remove them from the list before deleting them.");

  await prisma.adultLeader.delete({ where: { id } });

  const marks = leader._count.attendances;
  await recordAudit(session, {
    action: "adultLeader.delete",
    summary: `Permanently deleted ${leader.name} from the leader & committee list, with ${marks} attendance mark${
      marks === 1 ? "" : "s"
    }`,
    entityType: "AdultLeader",
    entityId: id,
  });

  revalidatePath(LEADERS_PATH, "layout");
}
