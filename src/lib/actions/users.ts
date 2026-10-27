"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import {
  assertAdmin,
  assertCanGrantRole,
  assertCanMutateUser,
  assertMasterAdmin,
  isDenScopedRole,
  isMasterAdminSession,
  isReservedUsername,
} from "@/lib/authorize";
import { generatePassword } from "@/lib/passwords";
import { CREDENTIAL_TRANSACTION, issueTokenInTransaction, lockUserRow } from "@/lib/resetTokens";
import { getAppBaseUrl } from "@/lib/appUrl";
import { canSetUserActive, isMasterAdminUsername, isProtectedUsername } from "@/lib/masterAdmins";
import { ASSIGNABLE_ROLES, DEN_ASSIGNABLE_ROLES, ROLE_LABELS, type AssignableRole } from "@/lib/roleLabels";
import { sendAccountLinkEmail } from "@/lib/email";
import { formatPhoneNumber } from "@/lib/phone";
import { denDisplayName } from "@/lib/rankConfig";
import { recordAudit, recordAuditInTransaction, changedFields } from "@/lib/audit";
import { isValidEmail, MAX_NAME_LENGTH } from "@/lib/formValues";
import { MAX_USERNAME_LENGTH } from "@/lib/credentialInput";
import type { CreatedInvite } from "@/lib/actions/dens";
import type { Rank } from "@/generated/prisma/enums";

/** Prisma's unique-constraint error: here, a username someone else just took. */
function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export async function createAdminAction(
  username: string,
  displayName: string,
  role: AssignableRole = "ADMIN",
  email?: string
) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  if (!ASSIGNABLE_ROLES.includes(role)) {
    return { ok: false as const, error: "Invalid role." };
  }
  try {
    await assertCanGrantRole(session, role);
  } catch {
    return { ok: false as const, error: "Only the master admin can create Admin accounts." };
  }

  // Called with arguments rather than a form, but still straight from the
  // browser: anything could arrive here, so check the types too.
  if (typeof username !== "string" || typeof displayName !== "string" || (email != null && typeof email !== "string")) {
    return { ok: false as const, error: "Username and display name are required." };
  }
  const clean = username.trim().toLowerCase();
  const name = displayName.trim();
  const cleanEmail = email?.trim() || null;
  if (!clean || !name) return { ok: false as const, error: "Username and display name are required." };
  if (clean.length > MAX_USERNAME_LENGTH) {
    return { ok: false as const, error: `Usernames can be at most ${MAX_USERNAME_LENGTH} characters.` };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false as const, error: `Display names can be at most ${MAX_NAME_LENGTH} characters.` };
  }
  if (cleanEmail && !isValidEmail(cleanEmail)) {
    return { ok: false as const, error: "Enter a single email address, like name@example.com." };
  }

  // The protected names are reserved whether or not a row currently holds
  // them. Master status is decided by username (src/lib/masterAdmins.ts), so
  // if one of those names ever came free — by any route, including a bug —
  // creating it here would hand the creator master privileges, audit log and
  // season reset included. Reserved is reserved; to reinstate a protected
  // account, restore the row rather than recreate the name.
  if (isReservedUsername(clean)) {
    return { ok: false as const, error: "That username is reserved and can't be created from the admin panel." };
  }

  const existing = await prisma.user.findUnique({ where: { username: clean } });
  if (existing) return { ok: false as const, error: "That username is already taken." };

  // No password is ever generated server-side for anyone to see — the account
  // starts with a random, immediately-discarded hash, and the new user sets
  // their own password via a one-time invite link. Hashed before the
  // transaction so nothing waits on bcrypt.
  const placeholderHash = await hashPassword(generatePassword());

  // The account, its invite link and the audit entry commit together: no
  // login without a way in, and no login without its record.
  let created: { userId: string; token: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: clean,
          passwordHash: placeholderHash,
          role,
          displayName: name,
          email: cleanEmail,
        },
      });
      const token = await issueTokenInTransaction(tx, user.id, "invite");
      await recordAuditInTransaction(tx, session, {
        action: "user.create",
        summary: `Created the ${ROLE_LABELS[role] ?? role} login “${clean}” for ${name}`,
        entityType: "User",
        entityId: user.id,
        details: [
          { label: "Username", from: "—", to: clean },
          { label: "Display name", from: "—", to: name },
          { label: "Role", from: "—", to: ROLE_LABELS[role] ?? role },
          ...(cleanEmail ? [{ label: "Email", from: "—", to: cleanEmail }] : []),
        ],
      });
      return { userId: user.id, token };
    }, CREDENTIAL_TRANSACTION);
  } catch (error) {
    // Two admins creating the same name at once: the check above passed for
    // both, and the database's unique index stopped the second.
    if (isUniqueViolation(error)) return { ok: false as const, error: "That username is already taken." };
    // Anything else (a lost connection, a timeout) rolled back the account,
    // its invite and its audit entry together, so trying again is safe.
    console.error("[users] creating an account failed", error);
    return { ok: false as const, error: "The account couldn't be created. Please try again in a moment." };
  }

  revalidatePath("/portal/admin/users");

  const url = `${getAppBaseUrl()}/portal/reset/${created.token}`;

  if (cleanEmail) {
    const { sent } = await sendAccountLinkEmail(cleanEmail, { username: clean, url, isNewAccount: true });
    if (sent) return { ok: true as const, emailedTo: cleanEmail };
  }
  const invite: CreatedInvite = { username: clean, url };
  return { ok: true as const, invite };
}

export async function resetPasswordAction(userId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }
  if (typeof userId !== "string" || !userId) return { ok: false as const, error: "User not found." };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!user) return { ok: false as const, error: "User not found." };

  // Only a master admin can reset a master admin's password. Without this,
  // a regular admin could reset the master's credentials and — if that
  // account has no email — have the new link revealed to them on screen.
  const masterOnly = "Only a master admin can reset a master admin's password.";
  try {
    await assertCanMutateUser(session, user);
  } catch {
    return { ok: false as const, error: masterOnly };
  }
  // Worked out now for the same check under the lock below, which can't make
  // its own query outside the transaction (the local dev database allows one
  // connection).
  const viewerIsMaster = await isMasterAdminSession(session);

  // The throwaway password is hashed before the transaction, so the account
  // row is never held locked for the length of a bcrypt hash.
  const placeholderHash = await hashPassword(generatePassword());

  // Immediately kill the current password and any live sessions — matching
  // the confirm dialog's promise that "the old password will stop working
  // immediately" — and issue a one-time link so the user picks their own
  // replacement. The server never generates or sees the new password.
  //
  // One transaction, under the account's lock (the same protocol as issuing
  // and finishing a link, src/lib/resetTokens.ts): the new link moves the
  // account to a new link generation, so any older link — even one whose
  // owner is mid-way through finishing it — can no longer replace the
  // password this sets. The audit entry commits with the change.
  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      if (!(await lockUserRow(tx, userId))) return null;
      // Re-read under the lock: this row is what the change is decided on.
      const current = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { username: true, displayName: true, email: true },
      });
      if (isMasterAdminUsername(current.username) && !viewerIsMaster) return "forbidden" as const;
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: placeholderHash,
          failedLoginCount: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      });
      const token = await issueTokenInTransaction(tx, userId, "reset");
      await recordAuditInTransaction(tx, session, {
        action: "user.resetPassword",
        summary: `Reset the password for “${current.username}” (${current.displayName}) — the old password and every live session stopped working`,
        entityType: "User",
        entityId: userId,
      });
      return { token, user: current };
    }, CREDENTIAL_TRANSACTION);
  } catch (error) {
    // Nothing above commits unless all of it does: the password, the sessions,
    // the old links and the audit entry are just as they were, so the Admin
    // can simply try again.
    console.error("[users] resetting a password failed", error);
    return { ok: false as const, error: "The password couldn't be reset. Please try again in a moment." };
  }
  if (!outcome) return { ok: false as const, error: "User not found." };
  if (outcome === "forbidden") return { ok: false as const, error: masterOnly };

  revalidatePath("/portal/admin/users");
  revalidatePath("/portal/admin/users/parents");

  // Sent only after the commit, so the link in the email is one that exists.
  const url = `${getAppBaseUrl()}/portal/reset/${outcome.token}`;

  if (outcome.user.email) {
    const { sent } = await sendAccountLinkEmail(outcome.user.email, {
      username: outcome.user.username,
      url,
      isNewAccount: false,
    });
    if (sent) return { ok: true as const, emailedTo: outcome.user.email };
  }
  const invite: CreatedInvite = { username: outcome.user.username, url };
  return { ok: true as const, invite };
}

export async function updateUserEmailAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const email = String(formData.get("email") || "").trim();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, displayName: true, email: true },
  });
  if (!user) throw new Error("User not found.");
  // A master admin's contact identity can only be changed by another master admin.
  await assertCanMutateUser(session, user);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { email: email || null } }),
    // Mirrors onto every scout contact row this login is linked to (siblings
    // share one login) — a no-op for staff accounts, which have no parentContacts.
    prisma.parent.updateMany({ where: { userId }, data: { email: email || null } }),
  ]);

  await recordAudit(session, {
    action: "user.updateEmail",
    summary: `Changed the email on “${user.username}” (${user.displayName})`,
    entityType: "User",
    entityId: userId,
    details: changedFields({ Email: [user.email, email || null] }),
  });

  revalidatePath(`/portal/admin/users/${userId}`);
  revalidatePath(`/portal/admin/users/parents/${userId}`);
  revalidatePath("/portal/admin/users/parents");
  revalidatePath("/portal/roster/parents");
  // A linked Leaders & Committee entry reads its contact info from this login.
  revalidatePath("/portal/admin/attendance/leaders/manage");
  revalidatePath("/portal/admin");
}

export async function updateUserPhoneAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const phone = formatPhoneNumber(String(formData.get("phone") || ""));

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, displayName: true, phone: true },
  });
  if (!user) throw new Error("User not found.");
  // A master admin's contact identity can only be changed by another master admin.
  await assertCanMutateUser(session, user);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { phone: phone || null } }),
    // A Parent Portal login's phone is mirrored onto every scout contact row
    // it's linked to (siblings share one login) — a no-op for staff accounts,
    // which have no parentContacts.
    prisma.parent.updateMany({ where: { userId }, data: { phone: phone || null } }),
  ]);

  await recordAudit(session, {
    action: "user.updatePhone",
    summary: `Changed the phone number on “${user.username}” (${user.displayName})`,
    entityType: "User",
    entityId: userId,
    details: changedFields({ Phone: [user.phone, phone || null] }),
  });

  revalidatePath(`/portal/admin/users/${userId}`);
  revalidatePath(`/portal/admin/users/parents/${userId}`);
  revalidatePath("/portal/admin/users/parents");
  revalidatePath("/portal/roster/parents");
  // A linked Leaders & Committee entry reads its contact info from this login.
  revalidatePath("/portal/admin/attendance/leaders/manage");
  revalidatePath("/portal/admin");
}

export async function updateUserDisplayNameAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const displayName = String(formData.get("displayName") || "").trim();
  if (!displayName) throw new Error("Display name is required.");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, displayName: true },
  });
  if (!user) throw new Error("User not found.");
  // A master admin's display identity can only be changed by another master admin.
  await assertCanMutateUser(session, user);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { displayName } }),
    // Mirrors onto every scout contact row this login is linked to (siblings
    // share one login) — a no-op for staff accounts, which have no parentContacts.
    prisma.parent.updateMany({ where: { userId }, data: { name: displayName } }),
  ]);

  await recordAudit(session, {
    action: "user.updateDisplayName",
    summary: `Renamed the login “${user.username}” to ${displayName}`,
    entityType: "User",
    entityId: userId,
    details: changedFields({ "Display name": [user.displayName, displayName] }),
  });

  revalidatePath(`/portal/admin/users/${userId}`);
  revalidatePath(`/portal/admin/users/parents/${userId}`);
  revalidatePath("/portal/admin/users");
  revalidatePath("/portal/admin/users/parents");
  revalidatePath("/portal/admin");
  revalidatePath("/portal/roster");
  revalidatePath("/portal/roster/parents");
}

export type UpdateUserRoleState = { error?: string };

/**
 * Changes an account between the four assignable roles (Admin, Junior
 * Admin, Attendance Only, Photographer). Den logins aren't editable here —
 * they're tied to a specific den and managed from that den's page. Master
 * admins can't be changed through the UI at all; see src/lib/masterAdmins.ts.
 */
export async function updateUserRoleAction(
  _prevState: UpdateUserRoleState,
  formData: FormData
): Promise<UpdateUserRoleState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { error: "Not authorized." };
  }

  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "");
  if (!ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
    return { error: "Invalid role." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found." };
  if (isMasterAdminUsername(user.username)) {
    return { error: "Master admins can't be changed from the admin panel." };
  }
  try {
    await assertCanGrantRole(session, role, user.role);
  } catch {
    return {
      error:
        user.role === "ADMIN"
          ? "Only the master admin can change an Admin's permission level."
          : "Only the master admin can make someone an Admin.",
    };
  }

  // Revoke existing sessions so the old role in their JWT stops being honored.
  await prisma.user.update({
    where: { id: userId },
    data: { role: role as AssignableRole, sessionVersion: { increment: 1 } },
  });
  // Den assignments grant access only for den-scoped roles (Den Leader,
  // Committee Member); moving to any other role would leave them as a
  // leftover leader listing, so clear them. Den Leader <-> Committee keeps
  // them, since the person still leads that den.
  let clearedDenAssignments = false;
  if (isDenScopedRole(user.role) && !isDenScopedRole(role as AssignableRole)) {
    await prisma.denAssignment.deleteMany({ where: { userId } });
    clearedDenAssignments = true;
  }

  await recordAudit(session, {
    action: "user.updateRole",
    summary: `Changed “${user.username}” (${user.displayName}) from ${ROLE_LABELS[user.role] ?? user.role} to ${
      ROLE_LABELS[role] ?? role
    }${clearedDenAssignments ? " — their den assignments were cleared" : ""}`,
    entityType: "User",
    entityId: userId,
    details: changedFields({
      Role: [ROLE_LABELS[user.role] ?? user.role, ROLE_LABELS[role] ?? role],
    }),
  });

  revalidatePath("/portal/admin/users");
  revalidatePath(`/portal/admin/users/${userId}`);
  redirect("/portal/admin/users");
}

export async function updateUserDensAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found.");
  if (!DEN_ASSIGNABLE_ROLES.includes(user.role as (typeof DEN_ASSIGNABLE_ROLES)[number])) {
    throw new Error("This account's role can't be assigned to dens.");
  }

  const denIds = formData.getAll("denIds").map(String);

  // Read the old assignments before replacing them, so the entry can show
  // which dens this login gained or lost rather than just the new list.
  const previousAssignments = await prisma.denAssignment.findMany({
    where: { userId },
    select: { den: { select: { rank: true, scoutingYear: true, label: true } } },
  });

  await prisma.$transaction([
    prisma.denAssignment.deleteMany({ where: { userId } }),
    prisma.denAssignment.createMany({ data: denIds.map((denId) => ({ userId, denId })) }),
    // Revoke existing sessions so the old denIds in their JWT stop granting access.
    prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }),
  ]);

  const nextDens = await prisma.den.findMany({
    where: { id: { in: denIds } },
    select: { rank: true, scoutingYear: true, label: true },
  });
  const nameList = (dens: { rank: Rank; scoutingYear: string; label: string }[]) =>
    dens.map((d) => denDisplayName(d.rank, d.scoutingYear, d.label)).sort().join(", ");

  await recordAudit(session, {
    action: "user.updateDens",
    summary: `Set the den assignments for “${user.username}” (${user.displayName}) to ${
      denIds.length === 0 ? "none" : nameList(nextDens)
    }`,
    entityType: "User",
    entityId: userId,
    details: changedFields({
      "Assigned dens": [nameList(previousAssignments.map((a) => a.den)) || null, nameList(nextDens) || null],
    }),
  });

  revalidatePath(`/portal/admin/users/${userId}`);
  revalidatePath("/portal/admin");
}

/**
 * Marks a staff login inactive (or active again) without deleting it. While
 * inactive it can't sign in, isn't listed as a den's leader and is left out of
 * Email Everyone; its den assignments stay, so switching it back on restores
 * all of that. A Leaders & Committee entry linked to the login follows it, so
 * the person drops off (and returns to) the leader attendance list too.
 */
export async function setUserActiveAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const active = String(formData.get("active") || "") === "true";
  if (!userId) throw new Error("Missing user id.");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, role: true, active: true },
  });
  if (!user) throw new Error("User not found.");

  const viewerIsMaster = await isMasterAdminSession(session);
  if (!canSetUserActive({ userId: session.userId, isMaster: viewerIsMaster }, user)) {
    throw new Error("This account can't be switched from here.");
  }
  if (user.active === active) return;

  const linkedLeader = await prisma.adultLeader.findUnique({
    where: { userId },
    select: { id: true, active: true },
  });
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      // Switching off also revokes any session they're signed in with right
      // now; the sign-in check keeps them out afterwards.
      data: active ? { active } : { active, sessionVersion: { increment: 1 } },
    }),
    ...(linkedLeader && linkedLeader.active !== active
      ? [prisma.adultLeader.update({ where: { id: linkedLeader.id }, data: { active } })]
      : []),
  ]);

  const who = `“${user.username}” (${user.displayName})`;
  await recordAudit(session, {
    action: active ? "user.reactivate" : "user.deactivate",
    summary: active
      ? `Marked the ${ROLE_LABELS[user.role] ?? user.role} login ${who} active again`
      : `Marked the ${ROLE_LABELS[user.role] ?? user.role} login ${who} inactive — it can't sign in and is hidden from rosters`,
    entityType: "User",
    entityId: userId,
    details: [
      { label: "Active", from: user.active ? "Yes" : "No", to: active ? "Yes" : "No" },
      ...(linkedLeader && linkedLeader.active !== active
        ? [{ label: "On the leader & committee list", from: linkedLeader.active ? "Yes" : "No", to: active ? "Yes" : "No" }]
        : []),
    ],
  });

  revalidatePath("/portal", "layout");
}

export async function deleteUserAction(userId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false as const, error: "User not found." };
  if (isProtectedUsername(user.username)) {
    return { ok: false as const, error: "This is a protected account and can't be deleted from the admin panel." };
  }
  // Admins can edit each other, but deleting an Admin account is the master
  // admin's call — the counterpart of assertCanGrantRole on creation.
  if (user.role === "ADMIN") {
    try {
      await assertMasterAdmin(session);
    } catch {
      return { ok: false as const, error: "Only the master admin can delete an Admin account." };
    }
  }
  if (userId === session.userId) {
    return { ok: false as const, error: "You can't delete your own account while logged in." };
  }

  // A Leaders & Committee entry linked to this login keeps its email and phone
  // only on the login (see adultLeaderContact.ts), and the link is nulled out
  // when the login goes — copy them onto the entry first so the person stays
  // reachable.
  const linkedLeader = await prisma.adultLeader.findUnique({ where: { userId }, select: { id: true } });
  await prisma.$transaction([
    ...(linkedLeader
      ? [prisma.adultLeader.update({ where: { id: linkedLeader.id }, data: { email: user.email, phone: user.phone } })]
      : []),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  await recordAudit(session, {
    action: "user.delete",
    summary: `Deleted the ${ROLE_LABELS[user.role] ?? user.role} login “${user.username}” (${user.displayName})`,
    entityType: "User",
    entityId: userId,
    details: [
      { label: "Username", from: user.username, to: "—" },
      { label: "Display name", from: user.displayName, to: "—" },
      { label: "Role", from: ROLE_LABELS[user.role] ?? user.role, to: "—" },
    ],
  });

  revalidatePath("/portal/admin/users");
  revalidatePath(`/portal/admin/users/${userId}`);
  revalidatePath("/portal/admin/users/parents");
  revalidatePath(`/portal/admin/users/parents/${userId}`);
  revalidatePath("/portal/roster/parents");
  revalidatePath("/portal/admin/attendance/leaders", "layout");
  return { ok: true as const };
}
