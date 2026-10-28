"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertPhotoConsentDenAccess, canManagePhotoConsentForDen } from "@/lib/authorize";
import { generatePhotoConsentToken, isPhotoConsentTokenShape } from "@/lib/photoConsentTokens";
import { getPublicBaseUrl } from "@/lib/appUrl";
import { sendPhotoConsentLinkEmail, sendPhotoConsentLinkEmails } from "@/lib/email";
import { consentGroup } from "@/lib/photoConsentGroups";
import { consentLinkRecipient, parentEmailOnFile } from "@/lib/photoConsentRecipients";
import { recordAudit } from "@/lib/audit";
import type { ConsentStatus, SignerRelationship } from "@/generated/prisma/enums";
import { isDateOnlyString } from "@/lib/dateOnly";
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, textField } from "@/lib/formValues";
import { isRequestKey } from "@/lib/requestKey";

const RELATIONSHIPS: SignerRelationship[] = ["PARENT", "GUARDIAN", "GRANDPARENT", "AUNT_UNCLE", "ADULT_SIBLING"];
const VENUES = ["facebook", "website", "fliers"] as const;

const ADMIN_PAGE_PATH = "/portal/roster/photo-consent";

const INVALID_LINK = "This link isn't valid. Ask your den leader for a new one.";

function consentLinkUrl(token: string) {
  return `${getPublicBaseUrl()}/consent/${token}`;
}

/** The consent form's fields, in the order they appear on it. */
export type ConsentField = (typeof VENUES)[number] | "signedByName" | "signedRelationship" | "signedDate";

/** What the parent entered, as plain strings (blank where nothing usable was given). */
export type ConsentFormValues = Record<ConsentField, string>;

export type SubmitConsentState = {
  error?: string;
  /** The field the error is about, so the form can mark it invalid and move focus to it. */
  field?: ConsentField;
  /**
   * What was entered, sent back with an error: React resets an action form
   * after every submit, so without this a refused form would come back
   * blank. Only values that are already safe to show — the name cut to its
   * limit, and choices and dates only when they're valid ones.
   */
  values?: ConsentFormValues;
  /** The answers just recorded, echoed back so the confirmation popup can show the parent what was saved. */
  saved?: { facebook: ConsentStatus; website: ConsentStatus; fliers: ConsentStatus };
};

const isAnswer = (v: string): v is "CONSENT" | "DECLINE" => v === "CONSENT" || v === "DECLINE";
const isRelationship = (v: string): v is SignerRelationship => (RELATIONSHIPS as string[]).includes(v);

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
  const token = textField(formData.get("token"));
  // A name typed on a phone, as one line: control characters (including the
  // NUL byte Postgres can't store) become spaces rather than a failed save.
  const signedByName = textField(formData.get("signedByName"))
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const signedRelationship = textField(formData.get("signedRelationship"));
  const signedDateRaw = textField(formData.get("signedDate"));
  const answers = {
    facebook: textField(formData.get("facebook")),
    website: textField(formData.get("website")),
    fliers: textField(formData.get("fliers")),
  };

  const values: ConsentFormValues = {
    facebook: isAnswer(answers.facebook) ? answers.facebook : "",
    website: isAnswer(answers.website) ? answers.website : "",
    fliers: isAnswer(answers.fliers) ? answers.fliers : "",
    signedByName: signedByName.slice(0, MAX_NAME_LENGTH),
    signedRelationship: isRelationship(signedRelationship) ? signedRelationship : "",
    signedDate: isDateOnlyString(signedDateRaw) ? signedDateRaw : "",
  };
  const refuse = (error: string, field?: ConsentField): SubmitConsentState => ({ error, field, values });

  // Every check below runs before any database work, so a malformed or
  // oversized request costs nothing but this.
  if (!isPhotoConsentTokenShape(token)) return refuse(INVALID_LINK);
  const unanswered = VENUES.find((venue) => !values[venue]);
  if (unanswered) return refuse("Choose consent or decline for all three.", unanswered);
  if (!signedByName) return refuse("Enter your name.", "signedByName");
  if (signedByName.length > MAX_NAME_LENGTH) {
    return refuse(`Your name can be at most ${MAX_NAME_LENGTH} characters.`, "signedByName");
  }
  if (!isRelationship(signedRelationship)) return refuse("Choose your relationship to the scout.", "signedRelationship");
  // isDateOnlyString rejects dates Date() would quietly roll over (Feb 31 →
  // Mar 3) and ones it can't parse at all (month 13), so a malformed value is
  // a readable error rather than a wrong stored date or a RangeError.
  if (!isDateOnlyString(signedDateRaw)) return refuse("Enter a valid date.", "signedDate");
  const signedDate = new Date(`${signedDateRaw}T00:00:00.000Z`);

  const { facebook, website, fliers } = answers as Record<(typeof VENUES)[number], "CONSENT" | "DECLINE">;
  const signedAt = new Date();
  const submission = { facebook, website, fliers, signedByName, signedRelationship, signedDate, signedAt };

  // Rotates the token in the same transaction as recording the submission, so
  // this exact link can't be reopened afterward to view the signer's info or
  // overwrite it again — a den leader/admin must issue a fresh link (see
  // regeneratePhotoConsentTokenAction) for any later change. The history row
  // is an append-only snapshot of what was submitted. The row is locked by
  // its token first, so a second submission of the same link (a double tap,
  // two family members at once) waits for this one and then finds the token
  // already rotated: one recorded answer and a readable error, never a crash.
  const recorded = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "PhotoConsent" WHERE "token" = ${token} FOR UPDATE`;
      const record = rows[0];
      if (!record) return false;
      await tx.photoConsentHistory.create({ data: { photoConsentId: record.id, ...submission } });
      await tx.photoConsent.update({
        where: { id: record.id },
        data: { ...submission, token: generatePhotoConsentToken() },
      });
      return true;
    },
    { timeout: 15000, maxWait: 10000 }
  );
  if (!recorded) return refuse(INVALID_LINK);

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

export type SendConsentEmailState = {
  error?: string;
  sent?: boolean;
  configured?: boolean;
  /** The send failed, but not in a way that proves nothing went out (no answer from Resend, a server error). */
  uncertain?: boolean;
  /** What Resend (or the address check) said, when a configured send didn't go out. */
  reason?: string;
  /** Set by the page, not this action: the request never got an answer from the server. */
  unreachable?: boolean;
};

const STALE_PAGE = "This page is out of date. Reload it and try again.";

/**
 * The two email buttons show this as is. Returned rather than thrown: a
 * thrown error reaches the page like a call that never got an answer, which
 * the buttons report as "we don't know whether it went out, press again".
 */
const SIGNED_OUT = "You've been signed out, so this didn't go through. Reload the page to sign in again.";

/**
 * Admin/den-leader — emails the existing consent link to a parent's address
 * on file. The form names the address it showed on its button; it is only
 * used to pick which stored Parent email of this scout to send to (matched
 * without regard to case), never sent to as typed, so a tampered request
 * can't mail a scout's consent link anywhere else.
 *
 * `requestKey` names the press (see requestKey.ts): after a send Resend
 * didn't confirm, the button sends the same key again, and Resend then
 * returns the first result rather than emailing the family a second copy.
 */
export async function sendPhotoConsentLinkEmailAction(
  _prevState: SendConsentEmailState,
  formData: FormData
): Promise<SendConsentEmailState> {
  const session = await getSession();
  if (!session) return { error: SIGNED_OUT };

  const scoutId = textField(formData.get("scoutId"));
  const requestedEmail = textField(formData.get("parentEmail"));
  if (!scoutId || !requestedEmail) return { error: "Missing scout or parent email." };
  const requestKey = textField(formData.get("requestKey"));
  if (!isRequestKey(requestKey)) return { error: STALE_PAGE };

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: {
      denId: true,
      firstName: true,
      active: true,
      photoConsent: { select: { token: true } },
      parents: { orderBy: { createdAt: "asc" }, select: { email: true } },
    },
  });
  if (!scout) return { error: "Scout not found." };
  try {
    assertPhotoConsentDenAccess(session, scout.denId);
  } catch {
    return { error: "Not authorized for this den." };
  }
  if (!scout.active) return { error: "This scout is marked inactive." };
  if (!scout.photoConsent) return { error: "Generate the link before emailing it." };

  const to = requestedEmail.length <= MAX_EMAIL_LENGTH ? parentEmailOnFile(scout.parents, requestedEmail) : null;
  if (!to) {
    return { error: "That address isn't a parent email on file for this scout. Refresh the page and try again." };
  }

  const result = await sendPhotoConsentLinkEmail(to, {
    scoutFirstName: scout.firstName,
    url: consentLinkUrl(scout.photoConsent.token),
    requestKey,
  });

  if (result.sent) {
    await recordAudit(session, {
      action: "photoConsent.emailLink",
      summary: `Emailed ${scout.firstName}'s photo consent link to ${to}`,
      entityType: "PhotoConsent",
      entityId: scoutId,
      denId: scout.denId,
    });
  } else if (result.uncertain) {
    await recordAudit(session, {
      action: "photoConsent.emailLinkUnconfirmed",
      summary: `Tried to email ${scout.firstName}'s photo consent link to ${to}, but Resend didn't confirm whether it went out`,
      entityType: "PhotoConsent",
      entityId: scoutId,
      denId: scout.denId,
    });
  }

  return {
    sent: result.sent,
    configured: result.configured,
    ...(result.uncertain ? { uncertain: true } : {}),
    ...(result.error ? { reason: result.error } : {}),
  };
}

export type EmailAllConsentLinksState = {
  error?: string;
  sent?: number;
  /** Certainly didn't go out: a refused address or link, or a refusal from Resend. */
  failed?: number;
  /** Resend didn't confirm whether these went out (no answer, a server error), so they may have. */
  unconfirmed?: number;
  /**
   * Nothing went to these this time: the press repeated an earlier one under
   * its key, but the list had changed since, so Resend refused it. The
   * earlier try may have reached some of them; others were never emailed.
   */
  listChanged?: number;
  configured?: boolean;
  /**
   * The unconfirmed ones can be retried by repeating this request under the
   * same key, which Resend answers with the first result rather than a second
   * copy. False once Resend has refused the key because the list changed.
   */
  repeatable?: boolean;
  /** Set by the page, not this action: the request never got an answer from the server. */
  unreachable?: boolean;
};

/**
 * Admin/den-leader — the Not Answered tab's Email All: sends every unanswered
 * scout in the dens this login manages their own consent link, generating one
 * first where none exists yet. Goes to the scout's first parent with a usable
 * email on file (consentLinkRecipient), same as the per-scout Email Link
 * button; scouts with none are skipped (the page lists how many). Recomputes
 * the list server-side rather than trusting anything from the form — the
 * form only sends `requestKey`, which names the press: repeating a press
 * that Resend didn't confirm sends the same key, so a family it did reach
 * isn't emailed twice (see sendPhotoConsentLinkEmails).
 */
export async function emailAllUnansweredConsentLinksAction(
  _prevState: EmailAllConsentLinksState,
  formData: FormData
): Promise<EmailAllConsentLinksState> {
  const session = await getSession();
  if (!session) return { error: SIGNED_OUT };
  const requestKey = textField(formData.get("requestKey"));
  if (!isRequestKey(requestKey)) return { error: STALE_PAGE };

  const dens = await prisma.den.findMany({ select: { id: true } });
  const denIds = dens.map((d) => d.id).filter((id) => canManagePhotoConsentForDen(session, id));
  if (denIds.length === 0) return { error: "Not authorized for any den." };

  const scouts = await prisma.scout.findMany({
    where: { denId: { in: denIds }, active: true },
    // A fixed order, so a repeat of the same press builds the same batches.
    orderBy: { id: "asc" },
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
    .map((s) => ({ ...s, email: consentLinkRecipient(s.parents) }))
    .filter((s): s is typeof s & { email: string } => !!s.email);
  if (targets.length === 0) return { sent: 0, failed: 0, unconfirmed: 0, configured: true };

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

  const { sent, unconfirmed, listChanged, configured } = await sendPhotoConsentLinkEmails(
    targets.map((s) => ({ to: s.email, scoutFirstName: s.firstName, url: consentLinkUrl(tokens.get(s.id)!) })),
    { requestKey }
  );

  for (const [i, scout] of targets.entries()) {
    if (sent[i]) {
      await recordAudit(session, {
        action: "photoConsent.emailLink",
        summary: `Emailed ${scout.firstName}'s photo consent link to ${scout.email} (Email All)`,
        entityType: "PhotoConsent",
        entityId: scout.id,
        denId: scout.denId,
      });
    } else if (unconfirmed[i]) {
      await recordAudit(session, {
        action: "photoConsent.emailLinkUnconfirmed",
        summary: `Tried to email ${scout.firstName}'s photo consent link to ${scout.email} (Email All), but Resend didn't confirm whether it went out`,
        entityType: "PhotoConsent",
        entityId: scout.id,
        denId: scout.denId,
      });
    }
    // Nothing is recorded for listChanged: this request sent them nothing,
    // and the earlier try that may have has its own entries.
  }

  revalidatePath(ADMIN_PAGE_PATH);
  const sentCount = sent.filter(Boolean).length;
  const unconfirmedCount = unconfirmed.filter(Boolean).length;
  const listChangedCount = listChanged.filter(Boolean).length;
  return {
    sent: sentCount,
    failed: targets.length - sentCount - unconfirmedCount - listChangedCount,
    unconfirmed: unconfirmedCount,
    ...(listChangedCount > 0 ? { listChanged: listChangedCount } : {}),
    configured,
    ...(unconfirmedCount > 0 ? { repeatable: listChangedCount === 0 } : {}),
  };
}
