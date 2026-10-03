"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  assertAdmin,
  assertCanMutateUser,
  assertLeaderAttendanceAccess,
  canResetLeaderAttendance,
} from "@/lib/authorize";
import { leadersListedForMeeting } from "@/lib/adultLeaderAttendanceData";
import { meetingIsSchedulable, meetingLabel } from "@/lib/attendanceData";
import { ADULT_LEADER_SECTION_LABELS, formatPositions, isAdultLeaderSection } from "@/lib/adultLeaderSections";
import { recordAudit, changedFields, EMPTY, type AuditDetail } from "@/lib/audit";
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
  const userId = String(formData.get("userId") || "").trim() || null;
  // A linked person's form has no email/phone inputs (their login holds
  // those), so an absent field means "leave it alone", not "blank it".
  const hasContactFields = formData.has("email") || formData.has("phone");

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
  return { name, positions, section, email: email || null, phone: phone || null, userId, hasContactFields };
}

/**
 * The login being linked, checked again server-side (the form only offers
 * valid ones): a Parent Portal login or the shared trip-viewer login isn't a
 * person on this list, and a login can be linked to one entry at a time.
 */
async function loadLinkableAccount(userId: string, leaderId: string | null) {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      email: true,
      phone: true,
      adultLeader: { select: { id: true } },
    },
  });
  if (!account || account.role === "PARENT" || account.role === "TRIP_VIEWER") {
    throw new Error("That account can't be linked.");
  }
  if (account.adultLeader && account.adultLeader.id !== leaderId) {
    throw new Error("That account is already linked to someone else on the list.");
  }
  return account;
}

/**
 * Linking makes the login the only copy of someone's email/phone, so anything
 * typed on the list for them moves onto the login first — but only into
 * blanks: an address already on the account is never overwritten. Mirrors
 * onto any scout-contact rows the login is tied to, like the account page's
 * own email/phone edits. Skipped for the master admin's account unless the
 * viewer is the master. Returns the account's contact info afterwards, plus
 * the audit lines for whatever moved.
 */
async function moveContactOntoAccount(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  account: { id: string; username: string; email: string | null; phone: string | null },
  typed: { email: string | null; phone: string | null }
): Promise<{ email: string | null; phone: string | null; details: AuditDetail[] }> {
  const unchanged = { email: account.email, phone: account.phone, details: [] as AuditDetail[] };
  const data: { email?: string; phone?: string } = {};
  if (!account.email && typed.email) data.email = typed.email;
  if (!account.phone && typed.phone) data.phone = typed.phone;
  if (Object.keys(data).length === 0) return unchanged;
  try {
    await assertCanMutateUser(session, account);
  } catch {
    return unchanged;
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: account.id }, data }),
    prisma.parent.updateMany({ where: { userId: account.id }, data }),
  ]);
  return {
    email: data.email ?? account.email,
    phone: data.phone ?? account.phone,
    details: [
      ...(data.email ? [{ label: `Email on “${account.username}”`, from: EMPTY, to: data.email }] : []),
      ...(data.phone ? [{ label: `Phone on “${account.username}”`, from: EMPTY, to: data.phone }] : []),
    ],
  };
}

async function nextSortOrder(section: AdultLeaderSection) {
  const { _max } = await prisma.adultLeader.aggregate({ where: { section }, _max: { sortOrder: true } });
  return (_max.sortOrder ?? 0) + 1;
}

export async function createAdultLeaderAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const { name, positions, section, email, phone, userId } = readLeaderForm(formData);

  const account = userId ? await loadLinkableAccount(userId, null) : null;
  const moved = account ? (await moveContactOntoAccount(session, account, { email, phone })).details : [];

  const leader = await prisma.adultLeader.create({
    data: {
      name,
      positions,
      section,
      // A linked person's contact info lives on their login only.
      email: account ? null : email,
      phone: account ? null : phone,
      userId: account?.id ?? null,
      sortOrder: await nextSortOrder(section),
    },
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
      ...(account ? [{ label: "Portal account", from: EMPTY, to: account.username }] : []),
      ...(!account && email ? [{ label: "Email", from: EMPTY, to: email }] : []),
      ...(!account && phone ? [{ label: "Phone", from: EMPTY, to: phone }] : []),
      ...moved,
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
  const form = readLeaderForm(formData);
  const { name, positions, section } = form;

  const before = await prisma.adultLeader.findUnique({
    where: { id },
    select: {
      name: true,
      positions: true,
      section: true,
      email: true,
      phone: true,
      userId: true,
      user: { select: { username: true, email: true, phone: true } },
    },
  });
  if (!before) throw new Error("That person is no longer on the list.");

  const account = form.userId ? await loadLinkableAccount(form.userId, id) : null;
  // Typed values count only when the form had the inputs (an unlinked person).
  const typed = form.hasContactFields ? { email: form.email, phone: form.phone } : { email: null, phone: null };

  // What goes in the entry's own columns, and what the person's contact info
  // reads as afterwards (for the audit line).
  let email: string | null;
  let phone: string | null;
  let emailAfter: string | null;
  let phoneAfter: string | null;
  let moved: AuditDetail[] = [];
  if (account) {
    // Linked: the login is the only copy, whether newly linked or already.
    email = null;
    phone = null;
    const result =
      before.userId === account.id
        ? { email: account.email, phone: account.phone, details: [] as AuditDetail[] }
        : await moveContactOntoAccount(session, account, typed);
    moved = result.details;
    emailAfter = result.email;
    phoneAfter = result.phone;
  } else {
    // Unlinked (or just unlinked): the entry's own columns hold the contact
    // info, carrying the login's over when there was one so it isn't lost.
    const carried = before.user ?? before;
    email = form.hasContactFields ? form.email : carried.email;
    phone = form.hasContactFields ? form.phone : carried.phone;
    emailAfter = email;
    phoneAfter = phone;
  }

  const emailBefore = before.user ? before.user.email : before.email;
  const phoneBefore = before.user ? before.user.phone : before.phone;

  await prisma.adultLeader.update({
    where: { id },
    data: {
      name,
      positions,
      section,
      email,
      phone,
      userId: account?.id ?? null,
      // Moving sections goes to the end of the new one, same as someone new.
      ...(section !== before.section ? { sortOrder: await nextSortOrder(section) } : {}),
    },
  });

  const details = changedFields({
    Name: [before.name, name],
    Positions: [formatPositions(before.positions), formatPositions(positions)],
    Section: [ADULT_LEADER_SECTION_LABELS[before.section], ADULT_LEADER_SECTION_LABELS[section]],
    "Portal account": [before.user?.username ?? null, account?.username ?? null],
    Email: [emailBefore, emailAfter],
    Phone: [phoneBefore, phoneAfter],
  });
  details.push(...moved);
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
