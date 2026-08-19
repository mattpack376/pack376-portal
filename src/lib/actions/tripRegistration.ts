"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { currentTripPriceCents } from "@/lib/tripPageData";
import { formatPhoneNumber } from "@/lib/phone";
import type { TripAffiliation } from "@/generated/prisma/enums";

const ADMIN_PATH = "/portal/admin/camp-conron";
const PUBLIC_PATH = "/camp-conron";

function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function parseCount(raw: FormDataEntryValue | null): number | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return 0;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegisterForTripState = { error?: string; success?: boolean };

/**
 * Public, unauthenticated registration for conron.pack376nyc.org — anyone
 * can submit this, no portal account involved. `website` is a hidden
 * honeypot field real visitors never see or fill; a bot that fills every
 * field on the form trips it and the submission is silently dropped (empty
 * state, same as a real success from the bot's point of view — an error
 * would tell it which field to leave blank). amountOwedCents is computed
 * here from the trip's currently-active price tier — never trust a
 * client-submitted amount. Returns state (via useActionState in the form,
 * same convention as loginAction) rather than throwing, so the client can
 * show a confirmation popup on success or an inline message on failure
 * instead of hitting Next's default error boundary.
 */
export async function registerForTripAction(
  _prevState: RegisterForTripState,
  formData: FormData,
): Promise<RegisterForTripState> {
  if (String(formData.get("website") || "").trim() !== "") return {};

  const tripPageId = String(formData.get("tripPageId") || "");
  const familyName = String(formData.get("familyName") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const contactPhone = formatPhoneNumber(String(formData.get("contactPhone") || "").trim());
  const affiliationRaw = String(formData.get("affiliation") || "");
  const payingCount = parseCount(formData.get("payingCount"));
  const freeCount = parseCount(formData.get("freeCount"));

  if (!tripPageId || !familyName || !contactEmail || !contactPhone) {
    return { error: "Name, email, phone, and trip are required." };
  }
  if (!EMAIL_RE.test(contactEmail)) return { error: "Enter a valid email address." };
  if (affiliationRaw !== "PACK" && affiliationRaw !== "TROOP") return { error: "Choose Pack 376 or Troop 376." };
  if (payingCount === null || freeCount === null) return { error: "Invalid attendee counts." };
  if (payingCount + freeCount === 0) return { error: "Enter at least one attendee." };

  const trip = await prisma.tripPage.findUnique({ where: { id: tripPageId } });
  if (!trip) return { error: "Trip not found." };

  const amountOwedCents = payingCount * currentTripPriceCents(trip);

  await prisma.tripRegistration.create({
    data: {
      tripPageId,
      familyName,
      contactEmail,
      contactPhone,
      affiliation: affiliationRaw as TripAffiliation,
      payingCount,
      freeCount,
      amountOwedCents,
    },
  });

  revalidatePath(ADMIN_PATH);
  revalidatePath(PUBLIC_PATH);
  return { success: true };
}

/** Admin-only, same population as the payment actions below — junior admin can view registrations but not edit them. */
export async function updateTripRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const familyName = String(formData.get("familyName") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const contactPhone = formatPhoneNumber(String(formData.get("contactPhone") || "").trim());
  const affiliationRaw = String(formData.get("affiliation") || "");
  const payingCount = parseCount(formData.get("payingCount"));
  const freeCount = parseCount(formData.get("freeCount"));
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));

  if (!id || !familyName || !contactEmail || !contactPhone) {
    throw new Error("Name, email, and phone are required.");
  }
  if (!EMAIL_RE.test(contactEmail)) throw new Error("Enter a valid email address.");
  if (affiliationRaw !== "PACK" && affiliationRaw !== "TROOP") throw new Error("Choose Pack 376 or Troop 376.");
  if (payingCount === null || freeCount === null) throw new Error("Invalid attendee counts.");
  if (payingCount + freeCount === 0) throw new Error("Enter at least one attendee.");
  if (amountOwedCents === null) throw new Error("A valid amount owed is required.");

  await prisma.tripRegistration.update({
    where: { id },
    data: {
      familyName,
      contactEmail,
      contactPhone,
      affiliation: affiliationRaw as TripAffiliation,
      payingCount,
      freeCount,
      amountOwedCents,
    },
  });

  revalidatePath(ADMIN_PATH);
  revalidatePath(PUBLIC_PATH);
}

/** Admin-only, same convention as requireEventPaymentSession — junior admin can view registrations but not record money. */
export async function addTripPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const tripRegistrationId = String(formData.get("tripRegistrationId") || "");
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  const paidOnRaw = String(formData.get("paidOn") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  if (!tripRegistrationId || amountCents === null || amountCents === 0) {
    throw new Error("A valid payment amount is required.");
  }

  const paidOn = paidOnRaw ? new Date(paidOnRaw) : new Date();
  if (Number.isNaN(paidOn.getTime())) throw new Error("Invalid payment date.");

  await prisma.tripPayment.create({
    data: { tripRegistrationId, amountCents, paidOn, note, recordedByUserId: session.userId },
  });

  revalidatePath(ADMIN_PATH);
}

export async function deleteTripPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const paymentId = String(formData.get("paymentId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  await prisma.tripPayment.delete({ where: { id: paymentId } });

  revalidatePath(ADMIN_PATH);
}

export async function deleteTripRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing registration id.");

  await prisma.tripRegistration.delete({ where: { id } });

  revalidatePath(ADMIN_PATH);
}
