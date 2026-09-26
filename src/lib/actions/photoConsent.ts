"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertPhotoConsentDenAccess, canManagePhotoConsentForDen } from "@/lib/authorize";
import { generatePhotoConsentToken } from "@/lib/photoConsentTokens";
import { getPublicBaseUrl } from "@/lib/appUrl";
import { sendPhotoConsentLinkEmail, sendPhotoConsentLinkEmails } from "@/lib/email";
import { consentGroup } from "@/lib/photoConsentGroups";
import { recordAudit } from "@/lib/audit";
import type { ConsentStatus, SignerRelationship } from "@/generated/prisma/enums";

const RELATIONSHIPS: SignerRelationship[] = ["PARENT", "GUARDIAN", "GRANDPARENT", "AUNT_UNCLE", "ADULT_SIBLING"];

const ADMIN_PAGE_PATH = "/portal/roster/photo-consent";

function consentLinkUrl(token: string) {
  return `${getPublicBaseUrl()}/consent/${token}`;
}

export type SubmitConsentState = {
  error?: string;
  /** The answers just recorded, echoed back so the confirmation popup can show the parent what was saved. */
  saved?: { facebook: ConsentStatus; website: ConsentStatus; fliers: ConsentStatus };
};

/**
 * Public — no session. The token itself is what authorizes this request,
 * same model as the portal's password-reset links.
 *
 * Deliberately not written to the AuditLog: that log records what portal staff
 * change, and this is a parent acting on their own child with no session at
 * all. PhotoConsentHistory below is already the append-only record of every
 * submission, including who signed it and when.
 */
export async function submitPhotoConsentAction(
  _prevState: SubmitConsentState,
  formData: FormData
): Promise<SubmitConsentState> {
  const token = String(formData.get("token") || "");
  const signedByName = String(formData.get("signedByName") || "").trim();
  const signedRelationship = String(formData.get("signedRelationship") || "") as SignerRelationship;
  const signedDateRaw = String(formData.get("signedDate") || "");
  const facebook = String(formData.get("facebook") || "") as ConsentStatus;
  const website = String(formData.get("website") || "") as ConsentStatus;
  const fliers = String(formData.get("fliers") || "") as ConsentStatus;

  if (!token) return { error: "Missing or invalid link." };
  if (!signedByName) return { error: "Enter your name." };
  if (!RELATIONSHIPS.includes(signedRelationship)) return { error: "Choose your relationship to the scout." };
  // Date() normalizes overflowing calendar dates instead of rejecting them —
  // e.g. "2026-02-31" silently becomes March 3rd — so a signer could end up
  // with a stored date that doesn't match what they typed. Round-tripping
  // back through toISOString() catches anything that got normalized.
  const signedDateCandidate = /^\d{4}-\d{2}-\d{2}$/.test(signedDateRaw) ? new Date(`${signedDateRaw}T00:00:00Z`) : null;
  const signedDate =
    signedDateCandidate && signedDateCandidate.toISOString().slice(0, 10) === signedDateRaw ? signedDateCandidate : null;
  if (!signedDate) return { error: "Enter a valid date." };
  const valid = (v: string): v is "CONSENT" | "DECLINE" => v === "CONSENT" || v === "DECLINE";
  if (!valid(facebook) || !valid(website) || !valid(fliers)) {
    return { error: "Choose consent or decline for all three." };
  }

  const record = await prisma.photoConsent.findUnique({ where: { token } });
  if (!record) return { error: "This link isn't valid. Ask your den leader for a new one." };

  const signedAt = new Date();
  const submission = { facebook, website, fliers, signedByName, signedRelationship, signedDate, signedAt };

  // Rotates the token in the same transaction as recording the submission, so
  // this exact link can't be reopened afterward to view the signer's info or
  // overwrite it again — a den leader/admin must issue a fresh link (see
  // regeneratePhotoConsentTokenAction) for any later change. The history row
  // is an append-only snapshot of what was submitted.
  await prisma.$transaction([
    prisma.photoConsentHistory.create({ data: { photoConsentId: record.id, ...submission } }),
    prisma.photoConsent.update({
      where: { token },
      data: { ...submission, token: generatePhotoConsentToken() },
    }),
  ]);

  return { saved: { facebook, website, fliers } };
}

/** Admin/den-leader — creates the consent record + token for a scout if one doesn't exist yet. */
export async function generatePhotoConsentLinkAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const scoutId = String(formData.get("scoutId") || "");
  if (!scoutId) throw new Error("Missing scout id.");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { denId: true, firstName: true, lastName: true, photoConsent: { select: { id: true } } },
  });
  if (!scout) throw new Error("Scout not found.");
  assertPhotoConsentDenAccess(session, scout.denId);

  await prisma.photoConsent.upsert({
    where: { scoutId },
    create: { scoutId, token: generatePhotoConsentToken() },
    update: {},
  });

  // The upsert is a no-op when a record already exists, so only log the case
  // where a link was actually created.
  if (!scout.photoConsent) {
    await recordAudit(session, {
      action: "photoConsent.generateLink",
      summary: `Generated a photo consent link for ${scout.firstName} ${scout.lastName}`,
      entityType: "PhotoConsent",
      entityId: scoutId,
      denId: scout.denId,
    });
  }

  revalidatePath(ADMIN_PAGE_PATH);
}

/** Admin/den-leader — rotates the token, invalidating the old link. Leaves consent answers untouched. */
export async function regeneratePhotoConsentTokenAction(scoutId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  if (!scoutId) throw new Error("Missing scout id.");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { denId: true, firstName: true, lastName: true },
  });
  if (!scout) throw new Error("Scout not found.");
  assertPhotoConsentDenAccess(session, scout.denId);

  await prisma.photoConsent.update({
    where: { scoutId },
    data: { token: generatePhotoConsentToken() },
  });

  await recordAudit(session, {
    action: "photoConsent.regenerateLink",
    summary: `Issued a fresh photo consent link for ${scout.firstName} ${scout.lastName} — the previous link no longer works`,
    entityType: "PhotoConsent",
    entityId: scoutId,
    denId: scout.denId,
  });

  revalidatePath(ADMIN_PAGE_PATH);
}

export type SendConsentEmailState = { error?: string; sent?: boolean; configured?: boolean };

/** Admin/den-leader — emails the existing consent link to a parent's address on file. */
export async function sendPhotoConsentLinkEmailAction(
  _prevState: SendConsentEmailState,
  formData: FormData
): Promise<SendConsentEmailState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };

  const scoutId = String(formData.get("scoutId") || "");
  const parentEmail = String(formData.get("parentEmail") || "").trim();
  if (!scoutId || !parentEmail) return { error: "Missing scout or parent email." };

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { denId: true, firstName: true, photoConsent: { select: { token: true } } },
  });
  if (!scout) return { error: "Scout not found." };
  try {
    assertPhotoConsentDenAccess(session, scout.denId);
  } catch {
    return { error: "Not authorized for this den." };
  }
  if (!scout.photoConsent) return { error: "Generate the link before emailing it." };

  const { sent, configured } = await sendPhotoConsentLinkEmail(parentEmail, {
    scoutFirstName: scout.firstName,
    url: consentLinkUrl(scout.photoConsent.token),
  });

  if (sent) {
    await recordAudit(session, {
      action: "photoConsent.emailLink",
      summary: `Emailed ${scout.firstName}'s photo consent link to ${parentEmail}`,
      entityType: "PhotoConsent",
      entityId: scoutId,
      denId: scout.denId,
    });
  }

  return { sent, configured };
}

export type EmailAllConsentLinksState = { error?: string; sent?: number; failed?: number; configured?: boolean };

/**
 * Admin/den-leader — the Not Answered tab's Email All: sends every unanswered
 * scout in the dens this login manages their own consent link, generating one
 * first where none exists yet. Goes to the scout's first parent with an email,
 * same as the per-scout Email Link button; scouts with no parent email are
 * skipped (the page lists how many). Recomputes the list server-side rather
 * than trusting anything from the form.
 */
// Takes no arguments: useActionState passes (prevState, formData), and neither
// is needed since the recipient list is rebuilt here from the database.
export async function emailAllUnansweredConsentLinksAction(): Promise<EmailAllConsentLinksState> {
  const session = await getSession();
  if (!session) return { error: "Not authorized." };

  const dens = await prisma.den.findMany({ select: { id: true } });
  const denIds = dens.map((d) => d.id).filter((id) => canManagePhotoConsentForDen(session, id));
  if (denIds.length === 0) return { error: "Not authorized for any den." };

  const scouts = await prisma.scout.findMany({
    where: { denId: { in: denIds } },
    select: {
      id: true,
      denId: true,
      firstName: true,
      lastName: true,
      photoConsent: { select: { token: true, facebook: true, website: true, fliers: true } },
      parents: { where: { email: { not: null } }, orderBy: { createdAt: "asc" }, select: { email: true } },
    },
  });
  const targets = scouts
    .filter((s) => consentGroup(s.photoConsent) === "unanswered")
    .map((s) => ({ ...s, email: s.parents.map((p) => p.email?.trim()).find((e) => !!e) }))
    .filter((s): s is typeof s & { email: string } => !!s.email);
  if (targets.length === 0) return { sent: 0, failed: 0, configured: true };

  // Scouts with no link yet get one now, same as clicking Generate Link.
  const tokens = new Map(targets.flatMap((s) => (s.photoConsent ? [[s.id, s.photoConsent.token] as const] : [])));
  for (const scout of targets.filter((s) => !s.photoConsent)) {
    const record = await prisma.photoConsent.upsert({
      where: { scoutId: scout.id },
      create: { scoutId: scout.id, token: generatePhotoConsentToken() },
      update: {},
    });
    tokens.set(scout.id, record.token);
    await recordAudit(session, {
      action: "photoConsent.generateLink",
      summary: `Generated a photo consent link for ${scout.firstName} ${scout.lastName}`,
      entityType: "PhotoConsent",
      entityId: scout.id,
      denId: scout.denId,
    });
  }

  const { sent, configured } = await sendPhotoConsentLinkEmails(
    targets.map((s) => ({ to: s.email, scoutFirstName: s.firstName, url: consentLinkUrl(tokens.get(s.id)!) }))
  );

  for (const [i, scout] of targets.entries()) {
    if (!sent[i]) continue;
    await recordAudit(session, {
      action: "photoConsent.emailLink",
      summary: `Emailed ${scout.firstName}'s photo consent link to ${scout.email} (Email All)`,
      entityType: "PhotoConsent",
      entityId: scout.id,
      denId: scout.denId,
    });
  }

  revalidatePath(ADMIN_PAGE_PATH);
  const sentCount = sent.filter(Boolean).length;
  return { sent: sentCount, failed: targets.length - sentCount, configured };
}
