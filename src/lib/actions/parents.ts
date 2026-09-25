"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { assertAdmin, assertCanMutateUser, isReservedUsername } from "@/lib/authorize";
import { generatePassword } from "@/lib/passwords";
import { issueInviteToken } from "@/lib/resetTokens";
import { getAppBaseUrl } from "@/lib/appUrl";
import { sendAccountLinkEmail } from "@/lib/email";
import { formatPhoneNumber } from "@/lib/phone";
import { recordAudit, changedFields } from "@/lib/audit";
import type { CreatedInvite } from "@/lib/actions/dens";

/**
 * If this email already belongs to a PARENT-role portal login (e.g. a
 * sibling's contact was invited earlier), returns that login's id so the new
 * or edited contact can be linked immediately instead of sitting disconnected
 * until someone happens to click Invite on it too.
 */
async function findExistingParentAccountId(email: string | null): Promise<string | null> {
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail) return null;
  const existing = await prisma.user.findUnique({ where: { username: cleanEmail } });
  return existing && existing.role === "PARENT" ? existing.id : null;
}

/** A scout's name + den for audit text on parent-contact changes. */
async function scoutContext(scoutId: string) {
  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { firstName: true, lastName: true, denId: true },
  });
  return { name: scout ? `${scout.firstName} ${scout.lastName}` : scoutId, denId: scout?.denId ?? null };
}

export async function addParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const scoutId = String(formData.get("scoutId") || "");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = formatPhoneNumber(String(formData.get("phone") || ""));
  if (!scoutId || !name) throw new Error("A parent name is required.");

  const userId = await findExistingParentAccountId(email);

  const parent = await prisma.parent.create({
    data: { scoutId, name, email: email || null, phone: phone || null, userId },
  });

  const scout = await scoutContext(scoutId);
  await recordAudit(session, {
    action: "parent.create",
    summary: `Added ${name} as a parent contact for ${scout.name}${
      userId ? " — linked to their existing Parent Portal login" : ""
    }`,
    entityType: "Parent",
    entityId: parent.id,
    denId: scout.denId,
    details: [
      { label: "Name", from: "—", to: name },
      ...(email ? [{ label: "Email", from: "—", to: email }] : []),
      ...(phone ? [{ label: "Phone", from: "—", to: phone }] : []),
    ],
  });

  revalidatePath("/portal/roster/parents");
}

export async function updateParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const parentId = String(formData.get("parentId") || "");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = formatPhoneNumber(String(formData.get("phone") || ""));
  if (!parentId || !name) throw new Error("A parent name is required.");

  const before = await prisma.parent.findUnique({
    where: { id: parentId },
    select: { userId: true, name: true, email: true, phone: true, scoutId: true },
  });
  // If this contact isn't linked yet and its (possibly just-edited) email now
  // matches an existing PARENT login, link it instead of leaving it stranded.
  const userId = before?.userId ?? (await findExistingParentAccountId(email));

  // Checked before anything is written: the sync below pushes
  // displayName/email/phone onto the linked User row, which is exactly what
  // updateUserDisplayNameAction/EmailAction/PhoneAction do in
  // actions/users.ts — and those are master-admin-gated. This path wasn't, so
  // a protected admin linked to a scout could have their name and contact
  // details rewritten from the roster screen instead.
  const linkedAccount = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { username: true } })
    : null;
  if (linkedAccount) await assertCanMutateUser(session, linkedAccount);

  const parent = await prisma.parent.update({
    where: { id: parentId },
    data: { name, email: email || null, phone: phone || null, userId },
  });

  // Keep the linked portal account's contact info — and every sibling contact
  // row sharing that same login — in sync with whatever's edited here, since
  // they all represent the same parent/guardian.
  if (parent.userId) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: parent.userId },
        data: { displayName: name, email: email || null, phone: phone || null },
      }),
      prisma.parent.updateMany({
        where: { userId: parent.userId, id: { not: parentId } },
        data: { phone: phone || null },
      }),
    ]);
    revalidatePath(`/portal/admin/users/parents/${parent.userId}`);
  }

  const scout = await scoutContext(parent.scoutId);
  await recordAudit(session, {
    action: "parent.update",
    summary: `Edited the parent contact ${name} for ${scout.name}${
      parent.userId ? " — their Parent Portal login was updated to match" : ""
    }`,
    entityType: "Parent",
    entityId: parentId,
    denId: scout.denId,
    details: changedFields({
      Name: [before?.name, name],
      Email: [before?.email, email || null],
      Phone: [before?.phone, phone || null],
    }),
  });

  revalidatePath("/portal/roster/parents");
  revalidatePath("/portal/admin/users/parents");
}

export async function removeParentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const parentId = String(formData.get("parentId") || "");
  if (!parentId) throw new Error("Missing parent id.");

  const parent = await prisma.parent.findUnique({
    where: { id: parentId },
    select: { userId: true, name: true, email: true, phone: true, scoutId: true },
  });

  // scoutIds is baked into the parent's session JWT at login time and lives
  // for up to 45 days; deleting the Parent row alone leaves any already-issued
  // session still vouching for that scout. Bumping sessionVersion invalidates
  // it immediately, forcing a fresh login that recomputes scoutIds from the
  // remaining relationships (siblings share one login, so other scouts on the
  // same account stay accessible after the re-login).
  await prisma.$transaction([
    prisma.parent.delete({ where: { id: parentId } }),
    ...(parent?.userId
      ? [prisma.user.update({ where: { id: parent.userId }, data: { sessionVersion: { increment: 1 } } })]
      : []),
  ]);

  const scout = parent ? await scoutContext(parent.scoutId) : { name: "a scout", denId: null };
  await recordAudit(session, {
    action: "parent.delete",
    summary: `Removed the parent contact ${parent?.name ?? parentId} from ${scout.name}${
      parent?.userId ? " — their Parent Portal session was revoked" : ""
    }`,
    entityType: "Parent",
    entityId: parentId,
    denId: scout.denId,
    details: parent
      ? [
          { label: "Name", from: parent.name, to: "—" },
          ...(parent.email ? [{ label: "Email", from: parent.email, to: "—" }] : []),
          ...(parent.phone ? [{ label: "Phone", from: parent.phone, to: "—" }] : []),
        ]
      : null,
  });

  revalidatePath("/portal/roster/parents");
}

/**
 * Invites a parent contact to the Parent Portal. Uses their email as the
 * login username — if a PARENT account already exists for that email (a
 * sibling's contact row invited earlier), this just links the new contact to
 * it instead of creating a second account, so one login covers every scout
 * in the family.
 */
export async function inviteParentPortalAction(parentId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const parent = await prisma.parent.findUnique({ where: { id: parentId } });
  if (!parent) return { ok: false as const, error: "Parent contact not found." };
  if (parent.userId) return { ok: false as const, error: "This parent already has a portal account." };

  const cleanEmail = parent.email?.trim().toLowerCase();
  if (!cleanEmail) {
    return { ok: false as const, error: "Add an email address for this parent before inviting them." };
  }

  const existing = await prisma.user.findUnique({ where: { username: cleanEmail } });
  if (existing) {
    if (existing.role !== "PARENT") {
      return { ok: false as const, error: "That email is already in use by a different portal account." };
    }
    await prisma.parent.update({ where: { id: parentId }, data: { userId: existing.id } });
    const scout = await scoutContext(parent.scoutId);
    await recordAudit(session, {
      action: "parent.linkPortal",
      summary: `Linked ${parent.name} (${scout.name}'s contact) to the existing Parent Portal login “${existing.username}”`,
      entityType: "Parent",
      entityId: parentId,
      denId: scout.denId,
    });
    revalidatePath("/portal/roster/parents");
    return { ok: true as const, linkedExisting: true };
  }

  // No password is ever generated server-side for anyone to see — the account
  // starts with a random, immediately-discarded hash, and the parent sets
  // their own password via a one-time invite link.
  const user = await prisma.user.create({
    data: {
      username: cleanEmail,
      passwordHash: await hashPassword(generatePassword()),
      role: "PARENT",
      displayName: parent.name,
      email: cleanEmail,
      phone: parent.phone,
    },
  });
  await prisma.parent.update({ where: { id: parentId }, data: { userId: user.id } });

  const invitedScout = await scoutContext(parent.scoutId);
  await recordAudit(session, {
    action: "parent.invitePortal",
    summary: `Invited ${parent.name} (${invitedScout.name}'s contact) to the Parent Portal as “${cleanEmail}”`,
    entityType: "User",
    entityId: user.id,
    denId: invitedScout.denId,
    details: [
      { label: "Login", from: "—", to: cleanEmail },
      { label: "Display name", from: "—", to: parent.name },
    ],
  });

  revalidatePath("/portal/roster/parents");

  const token = await issueInviteToken(user.id);
  const url = `${getAppBaseUrl()}/portal/reset/${token}`;

  const { sent } = await sendAccountLinkEmail(cleanEmail, { username: cleanEmail, url, isNewAccount: true });
  if (sent) return { ok: true as const, emailedTo: cleanEmail };
  const invite: CreatedInvite = { username: cleanEmail, url };
  return { ok: true as const, invite };
}

/**
 * Detaches a Parent Portal login from one specific scout, without touching
 * the account itself or its access to any other scouts (siblings can share
 * one login). The Parent contact row (name/email/phone) stays on that
 * scout's roster — only portal visibility into that scout is revoked.
 */
export async function unlinkParentScoutAction(parentId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const parent = await prisma.parent.findUnique({ where: { id: parentId } });
  if (!parent) return { ok: false as const, error: "Parent contact not found." };
  if (!parent.userId) return { ok: false as const, error: "This contact isn't linked to a portal account." };

  await prisma.$transaction([
    prisma.parent.update({ where: { id: parentId }, data: { userId: null } }),
    // Bump so an already-issued session (scoutIds are baked into the JWT) stops
    // vouching for the unlinked scout until the user logs in again.
    prisma.user.update({ where: { id: parent.userId }, data: { sessionVersion: { increment: 1 } } }),
  ]);

  const scout = await scoutContext(parent.scoutId);
  await recordAudit(session, {
    action: "parent.unlinkPortal",
    summary: `Revoked Parent Portal access to ${scout.name} for ${parent.name} — the contact row and their access to any other scouts are unchanged`,
    entityType: "Parent",
    entityId: parentId,
    denId: scout.denId,
  });

  revalidatePath("/portal/admin/users/parents");
  revalidatePath(`/portal/admin/users/parents/${parent.userId}`);
  revalidatePath("/portal/roster/parents");
  return { ok: true as const };
}

/**
 * Grants an existing Parent Portal login access to an additional scout —
 * e.g. a second child in the pack who doesn't yet have a contact row tied to
 * this account. Creates a new Parent contact (copying the account's current
 * name/email) rather than moving an existing one, since a scout's existing
 * contact rows may belong to a different guardian entirely.
 */
export async function attachParentToScoutAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const userId = String(formData.get("userId") || "");
  const scoutId = String(formData.get("scoutId") || "");
  if (!userId || !scoutId) throw new Error("Missing user or scout.");

  // Any role, not just PARENT: a den leader or admin is often a parent in the
  // pack too, and linking their own child lets them see that child's family
  // side without a second login (see /portal/my-family).
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("Account not found.");

  const existing = await prisma.parent.findFirst({ where: { userId, scoutId } });
  if (existing) throw new Error("This account is already attached to that scout.");

  await prisma.$transaction([
    prisma.parent.create({
      data: { scoutId, userId, name: user.displayName, email: user.email, phone: user.phone },
    }),
    // scoutIds are baked into the JWT at sign-in, so without this the newly
    // attached scout stays invisible until the session happens to expire.
    // Bumping ends the current session; the next sign-in picks the scout up.
    prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }),
  ]);

  const scout = await scoutContext(scoutId);
  await recordAudit(session, {
    action: "parent.attachScout",
    summary: `Gave the login “${user.username}” (${user.displayName}) Parent Portal access to ${scout.name}`,
    entityType: "User",
    entityId: userId,
    denId: scout.denId,
  });

  revalidatePath(`/portal/admin/users/parents/${userId}`);
  revalidatePath(`/portal/admin/users/${userId}`);
  revalidatePath("/portal/admin/users/parents");
  revalidatePath("/portal/roster/parents");
}

/** Deletes the linked portal account — revokes it for every scout it's tied to (siblings share one login). */
export async function revokeParentPortalAction(parentId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const parent = await prisma.parent.findUnique({ where: { id: parentId } });
  if (!parent) return { ok: false as const, error: "Parent contact not found." };
  if (!parent.userId) return { ok: false as const, error: "This parent doesn't have a portal account." };

  const account = await prisma.user.findUnique({
    where: { id: parent.userId },
    select: { username: true, displayName: true, role: true, _count: { select: { parentContacts: true } } },
  });
  if (!account) return { ok: false as const, error: "That portal account no longer exists." };

  /*
   * This button deletes a whole User row, so it has to hold the same line
   * deleteUserAction does in actions/users.ts — it used to hold none of it.
   *
   * attachParentToScoutAction above deliberately links staff accounts too (a
   * den leader who is also a parent in the pack), which meant any admin could
   * link a protected master admin to a scout and then "revoke" it here,
   * deleting the protected login. Master status is decided by username, so
   * the freed name could then be recreated as a plain ADMIN — a clean path
   * from ordinary admin to master admin.
   *
   * A staff login is never this button's business: unlinking one child from
   * an account is unlinkParentScoutAction, and deleting a staff account is
   * the Users panel, which has its own confirmation and its own guards.
   */
  if (account.role !== "PARENT") {
    return {
      ok: false as const,
      error:
        "That contact is linked to a staff login, not a Parent Portal account. Use “Unlink” to remove its access to this scout, or delete the account from Users.",
    };
  }
  // Belt and braces behind the role check above: a protected account is an
  // ADMIN and can't reach this line, but the rule lives in one place now, so
  // ask it rather than assume. Returns rather than throws, like every other
  // failure here — RevokeParentPortalButton shows the string.
  try {
    await assertCanMutateUser(session, account);
  } catch {
    return { ok: false as const, error: "That's a protected account. Only a master admin can change it." };
  }
  if (parent.userId === session.userId) {
    return { ok: false as const, error: "You can't delete your own account while logged in." };
  }

  await prisma.user.delete({ where: { id: parent.userId } });

  const scout = await scoutContext(parent.scoutId);
  await recordAudit(session, {
    action: "parent.revokePortal",
    summary: `Deleted the Parent Portal login “${account.username}” (${account.displayName}) — revoked for all ${
      account._count.parentContacts
    } scout(s) it covered, including ${scout.name}`,
    entityType: "User",
    entityId: parent.userId,
    denId: scout.denId,
  });

  revalidatePath("/portal/roster/parents");
  return { ok: true as const };
}

/**
 * Creates a Parent Portal login directly, without going through a scout's
 * parent contact and its Invite button. That flow needs an email already on
 * the contact and one contact row per scout; this one is for the cases it
 * can't reach — a guardian who isn't on any roster yet, a second login for a
 * household, or a parent who gave their email verbally.
 *
 * Attaching a scout is optional but expected: a PARENT login sees scouts
 * through Parent.userId (see scoutIds in lib/auth.ts), so one with nothing
 * attached signs in to an empty dashboard. Attach more later from Manage.
 */
export async function createParentAccountAction(
  username: string,
  displayName: string,
  email?: string,
  phone?: string,
  scoutId?: string,
) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authorized." };
  try {
    assertAdmin(session);
  } catch {
    return { ok: false as const, error: "Not authorized." };
  }

  const clean = username.trim().toLowerCase();
  const name = displayName.trim();
  const cleanEmail = email?.trim().toLowerCase() || null;
  const cleanPhone = phone?.trim() ? formatPhoneNumber(phone.trim()) : null;
  if (!clean || !name) return { ok: false as const, error: "Login and display name are required." };
  // Same reservation as createAdminAction in actions/users.ts — this form
  // creates a User row too, so it's a second way to claim a freed master name.
  if (isReservedUsername(clean)) {
    return { ok: false as const, error: "That login is reserved and can't be created from the admin panel." };
  }

  const existing = await prisma.user.findUnique({ where: { username: clean } });
  if (existing) {
    return {
      ok: false as const,
      error:
        existing.role === "PARENT"
          ? "That login already exists — attach the scout from its Manage page instead."
          : "That login is already in use by a different portal account.",
    };
  }

  if (scoutId) {
    const scout = await prisma.scout.findUnique({ where: { id: scoutId }, select: { id: true } });
    if (!scout) return { ok: false as const, error: "That scout no longer exists." };
  }

  // No password is ever generated server-side for anyone to see — the account
  // starts with a random, immediately-discarded hash, and the parent sets
  // their own password via a one-time invite link.
  const user = await prisma.user.create({
    data: {
      username: clean,
      passwordHash: await hashPassword(generatePassword()),
      role: "PARENT",
      displayName: name,
      email: cleanEmail,
      phone: cleanPhone,
    },
  });

  if (scoutId) {
    await prisma.parent.create({
      data: { scoutId, userId: user.id, name, email: cleanEmail, phone: cleanPhone },
    });
  }

  const attached = scoutId ? await scoutContext(scoutId) : null;
  await recordAudit(session, {
    action: "parent.createAccount",
    summary: `Created the Parent Portal login “${clean}” for ${name}${
      attached ? `, attached to ${attached.name}` : " with no scout attached yet"
    }`,
    entityType: "User",
    entityId: user.id,
    denId: attached?.denId ?? null,
    details: [
      { label: "Login", from: "—", to: clean },
      { label: "Display name", from: "—", to: name },
      ...(cleanEmail ? [{ label: "Email", from: "—", to: cleanEmail }] : []),
      ...(cleanPhone ? [{ label: "Phone", from: "—", to: cleanPhone }] : []),
    ],
  });

  revalidatePath("/portal/admin/users/parents");
  revalidatePath("/portal/roster/parents");

  const token = await issueInviteToken(user.id);
  const url = `${getAppBaseUrl()}/portal/reset/${token}`;

  if (cleanEmail) {
    const { sent } = await sendAccountLinkEmail(cleanEmail, { username: clean, url, isNewAccount: true });
    if (sent) return { ok: true as const, emailedTo: cleanEmail };
  }
  const invite: CreatedInvite = { username: clean, url };
  return { ok: true as const, invite };
}
