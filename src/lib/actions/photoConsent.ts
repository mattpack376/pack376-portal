"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertPhotoConsentDenAccess } from "@/lib/authorize";
import { generatePhotoConsentToken } from "@/lib/photoConsentTokens";
import { getPublicBaseUrl } from "@/lib/appUrl";
import { sendPhotoConsentLinkEmail } from "@/lib/email";
import type { ConsentStatus } from "@/generated/prisma/enums";

const ADMIN_PAGE_PATH = "/portal/roster/photo-consent";

function consentLinkUrl(token: string) {
  return `${getPublicBaseUrl()}/consent/${token}`;
}

export type SubmitConsentState = { error?: string; saved?: boolean };

/**
 * Public — no session. The token itself is what authorizes this request,
 * same model as the portal's password-reset links.
 */
export async function submitPhotoConsentAction(
  _prevState: SubmitConsentState,
  formData: FormData
): Promise<SubmitConsentState> {
  const token = String(formData.get("token") || "");
  const signedByName = String(formData.get("signedByName") || "").trim();
  const signedDateRaw = String(formData.get("signedDate") || "");
  const facebook = String(formData.get("facebook") || "") as ConsentStatus;
  const website = String(formData.get("website") || "") as ConsentStatus;
  const fliers = String(formData.get("fliers") || "") as ConsentStatus;

  if (!token) return { error: "Missing or invalid link." };
  if (!signedByName) return { error: "Enter your name." };
  const signedDate = /^\d{4}-\d{2}-\d{2}$/.test(signedDateRaw) ? new Date(`${signedDateRaw}T00:00:00Z`) : null;
  if (!signedDate) return { error: "Enter a valid date." };
  const valid = (v: string): v is "CONSENT" | "DECLINE" => v === "CONSENT" || v === "DECLINE";
  if (!valid(facebook) || !valid(website) || !valid(fliers)) {
    return { error: "Choose consent or decline for all three." };
  }

  const record = await prisma.photoConsent.findUnique({ where: { token } });
  if (!record) return { error: "This link isn't valid. Ask your den leader for a new one." };

  await prisma.photoConsent.update({
    where: { token },
    data: { facebook, website, fliers, signedByName, signedDate, signedAt: new Date() },
  });

  return { saved: true };
}

/** Admin/den-leader — creates the consent record + token for a scout if one doesn't exist yet. */
export async function generatePhotoConsentLinkAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const scoutId = String(formData.get("scoutId") || "");
  if (!scoutId) throw new Error("Missing scout id.");

  const scout = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!scout) throw new Error("Scout not found.");
  assertPhotoConsentDenAccess(session, scout.denId);

  await prisma.photoConsent.upsert({
    where: { scoutId },
    create: { scoutId, token: generatePhotoConsentToken() },
    update: {},
  });

  revalidatePath(ADMIN_PAGE_PATH);
}

/** Admin/den-leader — rotates the token, invalidating the old link. Leaves consent answers untouched. */
export async function regeneratePhotoConsentTokenAction(scoutId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  if (!scoutId) throw new Error("Missing scout id.");

  const scout = await prisma.scout.findUnique({ where: { id: scoutId }, select: { denId: true } });
  if (!scout) throw new Error("Scout not found.");
  assertPhotoConsentDenAccess(session, scout.denId);

  await prisma.photoConsent.update({
    where: { scoutId },
    data: { token: generatePhotoConsentToken() },
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

  return { sent, configured };
}
