"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertCanAddScoutsToDens, isReservedUsername } from "@/lib/authorize";
import { hashPassword } from "@/lib/auth";
import { generatePassword } from "@/lib/passwords";
import { deleteScoutCascade } from "@/lib/scoutDeletion";
import { issueInviteToken } from "@/lib/resetTokens";
import { getAppBaseUrl } from "@/lib/appUrl";
import { nextRank as computeNextRank, denDisplayName } from "@/lib/rankConfig";
import { parseScoutingYear } from "@/lib/attendanceSchedule";
import { recordAudit, changedFields } from "@/lib/audit";
import type { Rank } from "@/generated/prisma/enums";

export type CreatedInvite = { username: string; url: string };
export type DenActionState = { error?: string; invite?: CreatedInvite };

/**
 * Den logins never collect an email address, so their setup link always has
 * to be relayed on screen for the admin to share manually. The account's
 * initial passwordHash is a random value that's discarded immediately — no
 * one, including the creating admin, ever knows it. The den leader sets
 * their own password by following the link.
 */
async function createDenAccount(denId: string, rank: Rank, scoutingYear: string, username: string) {
  // The master-admin names are reserved everywhere a User row is created, not
  // just in the Users panel — see the same check in createAdminAction
  // (actions/users.ts). A den login can't become a master admin by itself,
  // but squatting one of those names would still block restoring the real one.
  if (isReservedUsername(username)) throw new Error("That username is reserved.");
  // Returns userId alongside the invite so the caller can audit the account it
  // just made; CreatedInvite itself stays username+url for the UI.
  const user = await prisma.user.create({
    data: {
      username: username.toLowerCase(),
      passwordHash: await hashPassword(generatePassword()),
      role: "DEN",
      displayName: `${rank} ${scoutingYear}`,
    },
  });
  await prisma.denAssignment.create({ data: { userId: user.id, denId } });
  const token = await issueInviteToken(user.id);
  return { userId: user.id, username: user.username, url: `${getAppBaseUrl()}/portal/reset/${token}` };
}

/** A den's display name for audit text, falling back to the raw id. */
async function denLabel(denId: string) {
  if (!denId) return "a den";
  const den = await prisma.den.findUnique({
    where: { id: denId },
    select: { rank: true, scoutingYear: true, label: true },
  });
  return den ? denDisplayName(den.rank, den.scoutingYear, den.label) : denId;
}

export async function createDenAction(
  _prevState: DenActionState,
  formData: FormData
): Promise<DenActionState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { error: "Not authorized." };
  }

  const rank = String(formData.get("rank") || "") as Rank;
  const scoutingYear = String(formData.get("scoutingYear") || "").trim();
  const label = String(formData.get("label") || "").trim();
  const createLogin = formData.get("createLogin") === "on";
  const username = String(formData.get("username") || "").trim();

  if (!rank || !scoutingYear) {
    return { error: "Rank and scouting year are required." };
  }
  try {
    parseScoutingYear(scoutingYear);
  } catch {
    return { error: 'Scouting year must look like "2026-2027" (two consecutive years).' };
  }

  const existing = await prisma.den.findUnique({
    where: { rank_scoutingYear_label: { rank, scoutingYear, label } },
  });
  if (existing) {
    return { error: "A den with this rank, year, and label already exists." };
  }

  const den = await prisma.den.create({ data: { rank, scoutingYear, label } });

  await recordAudit(session, {
    action: "den.create",
    summary: `Created ${denDisplayName(rank, scoutingYear, label)}`,
    entityType: "Den",
    entityId: den.id,
    denId: den.id,
  });

  let invite: CreatedInvite | undefined;
  if (createLogin) {
    if (!username) return { error: "Den created, but a username is required to create its login." };
    const usernameTaken = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (usernameTaken) return { error: "Den created, but that username is already taken." };
    if (isReservedUsername(username)) return { error: "Den created, but that username is reserved." };
    const account = await createDenAccount(den.id, rank, scoutingYear, username);
    invite = { username: account.username, url: account.url };
    await recordAudit(session, {
      action: "user.create",
      summary: `Created den leader login "${account.username}" for ${denDisplayName(rank, scoutingYear, label)}`,
      entityType: "User",
      entityId: account.userId,
      denId: den.id,
    });
  }

  revalidatePath("/portal/admin");
  return { invite };
}

// Junior Admins can add a scout too; renaming and removing stay admin-only.
export async function addScoutAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertCanAddScoutsToDens(session);

  const denId = String(formData.get("denId") || "");
  const firstName = String(formData.get("firstName") || "").trim();
  const lastName = String(formData.get("lastName") || "").trim();
  if (!denId || !firstName || !lastName) throw new Error("Missing scout name.");

  const scout = await prisma.scout.create({ data: { denId, firstName, lastName } });

  await recordAudit(session, {
    action: "scout.create",
    summary: `Added scout ${firstName} ${lastName} to ${await denLabel(denId)}`,
    entityType: "Scout",
    entityId: scout.id,
    denId,
  });

  revalidatePath(`/portal/admin/dens/${denId}`);
}

export async function updateScoutNameAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const denId = String(formData.get("denId") || "");
  const firstName = String(formData.get("firstName") || "").trim();
  const lastName = String(formData.get("lastName") || "").trim();
  if (!scoutId || !firstName || !lastName) throw new Error("First and last name are required.");

  const before = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { firstName: true, lastName: true },
  });

  await prisma.scout.update({ where: { id: scoutId }, data: { firstName, lastName } });

  await recordAudit(session, {
    action: "scout.rename",
    summary: before
      ? `Renamed scout ${before.firstName} ${before.lastName} to ${firstName} ${lastName}`
      : `Renamed a scout to ${firstName} ${lastName}`,
    entityType: "Scout",
    entityId: scoutId,
    denId: denId || null,
    details: changedFields({
      "First name": [before?.firstName, firstName],
      "Last name": [before?.lastName, lastName],
    }),
  });

  revalidatePath(`/portal/admin/dens/${denId}`);
  revalidatePath("/portal/roster");
}

export async function removeScoutAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const denId = String(formData.get("denId") || "");
  if (!scoutId) throw new Error("Missing scout id.");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { firstName: true, lastName: true },
  });

  await deleteScoutCascade(scoutId);

  await recordAudit(session, {
    action: "scout.delete",
    summary: `Removed scout ${scout ? `${scout.firstName} ${scout.lastName}` : scoutId} from ${await denLabel(denId)} — with their advancement, attendance, dues and parent contacts`,
    entityType: "Scout",
    entityId: scoutId,
    denId: denId || null,
  });

  revalidatePath(`/portal/admin/dens/${denId}`);
  revalidatePath("/portal/admin/users/scouts");
  revalidatePath("/portal/roster");
}

export async function promoteDenAction(
  _prevState: DenActionState,
  formData: FormData
): Promise<DenActionState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { error: "Not authorized." };
  }

  const denId = String(formData.get("denId") || "");
  const scoutingYear = String(formData.get("scoutingYear") || "").trim();
  const createLogin = formData.get("createLogin") === "on";
  const username = String(formData.get("username") || "").trim();

  const den = await prisma.den.findUnique({ where: { id: denId }, include: { scouts: true } });
  if (!den) return { error: "Den not found." };

  const next = computeNextRank(den.rank);
  if (!next) return { error: "Arrow of Light is the final rank — there's no next den to promote to." };
  if (!scoutingYear) return { error: "Enter the new scouting year." };
  try {
    parseScoutingYear(scoutingYear);
  } catch {
    return { error: 'Scouting year must look like "2027-2028" (two consecutive years).' };
  }

  const existing = await prisma.den.findUnique({
    where: { rank_scoutingYear_label: { rank: next, scoutingYear, label: den.label } },
  });
  if (existing) return { error: "A den already exists for that rank, year, and label." };

  const newDen = await prisma.den.create({
    data: { rank: next, scoutingYear, label: den.label },
  });

  if (den.scouts.length > 0) {
    await prisma.scout.createMany({
      data: den.scouts.map((s) => ({
        denId: newDen.id,
        firstName: s.firstName,
        lastName: s.lastName,
      })),
    });
  }

  await recordAudit(session, {
    action: "den.promote",
    summary: `Promoted ${denDisplayName(den.rank, den.scoutingYear, den.label)} to ${denDisplayName(next, scoutingYear, den.label)} — carried ${den.scouts.length} scout${den.scouts.length === 1 ? "" : "s"} forward`,
    entityType: "Den",
    entityId: newDen.id,
    denId: newDen.id,
    details: [
      { label: "From den", from: denDisplayName(den.rank, den.scoutingYear, den.label), to: denDisplayName(next, scoutingYear, den.label) },
      { label: "Scouts carried forward", from: "—", to: String(den.scouts.length) },
    ],
  });

  let invite: CreatedInvite | undefined;
  if (createLogin) {
    if (!username) return { error: "Den promoted, but a username is required to create its login." };
    const usernameTaken = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (usernameTaken) return { error: "Den promoted, but that username is already taken." };
    if (isReservedUsername(username)) return { error: "Den promoted, but that username is reserved." };
    const account = await createDenAccount(newDen.id, next, scoutingYear, username);
    invite = { username: account.username, url: account.url };
    await recordAudit(session, {
      action: "user.create",
      summary: `Created den leader login "${account.username}" for ${denDisplayName(next, scoutingYear, den.label)}`,
      entityType: "User",
      entityId: account.userId,
      denId: newDen.id,
    });
  }

  revalidatePath("/portal/admin");
  if (!invite) {
    redirect(`/portal/admin/dens/${newDen.id}`);
  }
  return { invite };
}
