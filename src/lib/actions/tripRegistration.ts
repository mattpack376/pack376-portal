"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { currentTripPriceCents } from "@/lib/tripPageData";
import { formatPhoneNumber } from "@/lib/phone";
import { recordAudit, changedFields, auditMoney, auditDate } from "@/lib/audit";
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
 *
 * Not written to the AuditLog: there's no actor to attribute it to, and the
 * TripRegistration row itself (with its createdAt) already is the record of a
 * family signing up. The log covers what staff do to these rows afterwards —
 * the edit, payment and delete actions below.
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
  const guestOfName = String(formData.get("guestOfName") || "").trim();
  const affiliationRaw = String(formData.get("affiliation") || "");
  const payingCount = parseCount(formData.get("payingCount"));
  const freeCount = parseCount(formData.get("freeCount"));

  if (!tripPageId || !familyName || !contactEmail || !contactPhone || !guestOfName) {
    return { error: "Name, email, phone, guest-of, and trip are required." };
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
      guestOfName,
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
  const guestOfName = String(formData.get("guestOfName") || "").trim();
  const affiliationRaw = String(formData.get("affiliation") || "");
  const payingCount = parseCount(formData.get("payingCount"));
  const freeCount = parseCount(formData.get("freeCount"));
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));

  if (!id || !familyName || !contactEmail || !contactPhone || !guestOfName) {
    throw new Error("Name, email, phone, and guest-of are required.");
  }
  if (!EMAIL_RE.test(contactEmail)) throw new Error("Enter a valid email address.");
  if (affiliationRaw !== "PACK" && affiliationRaw !== "TROOP") throw new Error("Choose Pack 376 or Troop 376.");
  if (payingCount === null || freeCount === null) throw new Error("Invalid attendee counts.");
  if (payingCount + freeCount === 0) throw new Error("Enter at least one attendee.");
  if (amountOwedCents === null) throw new Error("A valid amount owed is required.");

  const before = await prisma.tripRegistration.findUnique({
    where: { id },
    select: {
      familyName: true,
      contactEmail: true,
      contactPhone: true,
      guestOfName: true,
      affiliation: true,
      payingCount: true,
      freeCount: true,
      amountOwedCents: true,
    },
  });

  await prisma.tripRegistration.update({
    where: { id },
    data: {
      familyName,
      contactEmail,
      contactPhone,
      guestOfName,
      affiliation: affiliationRaw as TripAffiliation,
      payingCount,
      freeCount,
      amountOwedCents,
    },
  });

  await recordAudit(session, {
    action: "tripRegistration.update",
    summary: `Edited the trip registration for ${familyName}`,
    entityType: "TripRegistration",
    entityId: id,
    details: changedFields({
      "Family name": [before?.familyName, familyName],
      Email: [before?.contactEmail, contactEmail],
      Phone: [before?.contactPhone, contactPhone],
      "Guest of": [before?.guestOfName, guestOfName],
      Affiliation: [before?.affiliation, affiliationRaw],
      "Paying attendees": [before?.payingCount, payingCount],
      "Free attendees": [before?.freeCount, freeCount],
      "Amount owed": [
        before ? auditMoney(before.amountOwedCents) : null,
        auditMoney(amountOwedCents),
      ],
    }),
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

  const payment = await prisma.tripPayment.create({
    data: { tripRegistrationId, amountCents, paidOn, note, recordedByUserId: session.userId },
  });

  const registration = await prisma.tripRegistration.findUnique({
    where: { id: tripRegistrationId },
    select: { familyName: true },
  });
  await recordAudit(session, {
    action: "tripPayment.add",
    summary: `Recorded a ${auditMoney(amountCents)} trip payment from ${registration?.familyName ?? "a family"}`,
    entityType: "TripPayment",
    entityId: payment.id,
    details: [
      { label: "Amount", from: "—", to: auditMoney(amountCents) },
      { label: "Paid on", from: "—", to: auditDate(paidOn) },
      ...(note ? [{ label: "Note", from: "—", to: note }] : []),
    ],
  });

  revalidatePath(ADMIN_PATH);
}

export async function deleteTripPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const paymentId = String(formData.get("paymentId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  // Read before deleting — the amount is only recoverable from this entry after.
  const payment = await prisma.tripPayment.findUnique({
    where: { id: paymentId },
    select: { amountCents: true, paidOn: true, note: true, tripRegistration: { select: { familyName: true } } },
  });

  await prisma.tripPayment.delete({ where: { id: paymentId } });

  await recordAudit(session, {
    action: "tripPayment.delete",
    summary: payment
      ? `Deleted a ${auditMoney(payment.amountCents)} trip payment from ${payment.tripRegistration.familyName}`
      : "Deleted a trip payment",
    entityType: "TripPayment",
    entityId: paymentId,
    details: payment
      ? [
          { label: "Amount", from: auditMoney(payment.amountCents), to: "—" },
          { label: "Paid on", from: auditDate(payment.paidOn), to: "—" },
          ...(payment.note ? [{ label: "Note", from: payment.note, to: "—" }] : []),
        ]
      : null,
  });

  revalidatePath(ADMIN_PATH);
}

export async function deleteTripRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing registration id.");

  const registration = await prisma.tripRegistration.findUnique({
    where: { id },
    select: {
      familyName: true,
      contactEmail: true,
      payingCount: true,
      freeCount: true,
      amountOwedCents: true,
      _count: { select: { payments: true } },
    },
  });

  await prisma.tripRegistration.delete({ where: { id } });

  await recordAudit(session, {
    action: "tripRegistration.delete",
    summary: `Deleted the trip registration for ${registration?.familyName ?? id}${
      registration && registration._count.payments > 0
        ? ` — along with ${registration._count.payments} recorded payment(s)`
        : ""
    }`,
    entityType: "TripRegistration",
    entityId: id,
    details: registration
      ? [
          { label: "Family name", from: registration.familyName, to: "—" },
          { label: "Email", from: registration.contactEmail, to: "—" },
          { label: "Attendees", from: `${registration.payingCount} paying, ${registration.freeCount} free`, to: "—" },
          { label: "Amount owed", from: auditMoney(registration.amountOwedCents), to: "—" },
        ]
      : null,
  });

  revalidatePath(ADMIN_PATH);
}
