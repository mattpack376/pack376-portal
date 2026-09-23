"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { checkRateLimit } from "@vercel/firewall";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin } from "@/lib/authorize";
import { currentTripPriceCents, registrationClosed } from "@/lib/tripPageData";
import { formatPhoneNumber } from "@/lib/phone";
import { recordAudit, changedFields, auditMoney, auditDate } from "@/lib/audit";
import type { TripAffiliation } from "@/generated/prisma/enums";

const ADMIN_PATH = "/portal/admin/camp-conron";
const PUBLIC_PATH = "/camp-conron";

/*
 * Bounds for the public form below. Nothing here is a business rule — these
 * are the limits that stop one unauthenticated caller from writing rows of
 * arbitrary size, or an unbounded number of them, into the database. The
 * admin actions further down deliberately don't apply them: a signed-in admin
 * fixing up a registration is a different trust level entirely.
 */
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 maximum for a complete address
const MAX_PHONE_LENGTH = 40;
const MAX_ATTENDEES = 50;
/**
 * A persistent ceiling on how many separate registrations one email address
 * can file for one trip. The Vercel Firewall rate limit below is the first
 * line, but it's configured outside this repo and fails open if the rule is
 * missing — this one is enforced by the database read that precedes the
 * write, so it holds regardless.
 */
const MAX_REGISTRATIONS_PER_EMAIL = 10;

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

export type RegisterForTripState = {
  error?: string;
  success?: boolean;
  /**
   * Identifies the submission a success belongs to: a fresh id each time one
   * goes through, and the previous one carried over unchanged when one
   * doesn't. Two successes in a row are otherwise indistinguishable
   * ({ success: true } both times) and the form has to tell them apart — it
   * clears itself by keying its fields off this value
   * (TripRegistrationForm.tsx), so every success has to read as new while a
   * failure that follows one must not.
   */
  submissionId?: string;
};

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
  prevState: RegisterForTripState,
  formData: FormData,
): Promise<RegisterForTripState> {
  const result = await submitTripRegistration(formData);
  // Only a submission that actually went through mints a new submissionId.
  // Everything else — a validation error, a rate limit, the honeypot —
  // hands back the one already in state, so a failed attempt after a
  // successful one doesn't read as a second success to the form.
  return result.success
    ? { ...result, submissionId: crypto.randomUUID() }
    : { ...result, submissionId: prevState.submissionId };
}

/** The work itself; registerForTripAction above owns the returned state's submissionId. */
async function submitTripRegistration(formData: FormData): Promise<RegisterForTripState> {
  if (String(formData.get("website") || "").trim() !== "") return {};

  // Before any database work, the same way loginAction does it. Enforced by a
  // matching "trip-registration" rule in the Vercel Firewall dashboard; with
  // no such rule this is a no-op, which is why the per-email ceiling further
  // down is enforced in the database rather than relying on this.
  const { rateLimited } = await checkRateLimit("trip-registration", { headers: await headers() });
  if (rateLimited) {
    return { error: "Too many registration attempts from this connection. Try again in a few minutes." };
  }

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
  // Nothing on the form has a length limit in the browser, and the Server
  // Action body allowance is 8MB for photo uploads — so without these an
  // anonymous caller can store a 100,000-character name.
  if (familyName.length > MAX_NAME_LENGTH || guestOfName.length > MAX_NAME_LENGTH) {
    return { error: `Names must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  if (contactEmail.length > MAX_EMAIL_LENGTH) return { error: "Enter a valid email address." };
  if (contactPhone.length > MAX_PHONE_LENGTH) return { error: "Enter a valid phone number." };
  if (!EMAIL_RE.test(contactEmail)) return { error: "Enter a valid email address." };
  if (affiliationRaw !== "PACK" && affiliationRaw !== "TROOP") return { error: "Choose Pack 376 or Troop 376." };
  if (payingCount === null || freeCount === null) return { error: "Invalid attendee counts." };
  if (payingCount + freeCount === 0) return { error: "Enter at least one attendee." };
  if (payingCount + freeCount > MAX_ATTENDEES) {
    return { error: `That's more than ${MAX_ATTENDEES} attendees — email us instead and we'll add your group.` };
  }

  const trip = await prisma.tripPage.findUnique({ where: { id: tripPageId } });
  // Three separate reasons, one answer: an id that doesn't exist, a trip
  // that isn't published, and a trip past its RSVP deadline all get the same
  // message. Registration used to accept any of them — the id came straight
  // from the form, so neither the unpublished draft nor the closed trip was
  // actually out of reach. An admin can still add a late family by hand from
  // the Camp Conron admin page (addTripRegistrationAction below).
  if (!trip || !trip.published || registrationClosed(trip)) {
    return { error: "Registration for this trip is closed. Please contact us and we'll help you out." };
  }

  const normalizedEmail = contactEmail.toLowerCase();
  const sameEmail = await prisma.tripRegistration.findMany({
    where: { tripPageId, contactEmail: { equals: normalizedEmail, mode: "insensitive" } },
    select: { familyName: true, payingCount: true, freeCount: true },
  });
  // A resubmitted form — a double-click, a refresh, a replayed request —
  // reports the success it would have reported the first time rather than
  // filing a second identical row. A genuinely different second group from
  // the same address still goes through.
  const isReplay = sameEmail.some(
    (r) => r.familyName === familyName && r.payingCount === payingCount && r.freeCount === freeCount,
  );
  if (isReplay) return { success: true };
  if (sameEmail.length >= MAX_REGISTRATIONS_PER_EMAIL) {
    return { error: "This email already has several registrations for this trip. Please contact us to add more." };
  }

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

/**
 * The staffed way in after the public form has closed — an admin adding a
 * family who registered late, called in, or signed up on paper. This is the
 * "controlled exception" that lets registerForTripAction above enforce the
 * RSVP deadline without stranding anyone: the deadline closes the public
 * door, not the pack's ability to take a registration.
 *
 * Audited, unlike the public action, because here there is an actor.
 */
export async function addTripRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const tripPageId = String(formData.get("tripPageId") || "");
  const familyName = String(formData.get("familyName") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const contactPhone = formatPhoneNumber(String(formData.get("contactPhone") || "").trim());
  const guestOfName = String(formData.get("guestOfName") || "").trim();
  const affiliationRaw = String(formData.get("affiliation") || "");
  const payingCount = parseCount(formData.get("payingCount"));
  const freeCount = parseCount(formData.get("freeCount"));

  if (!tripPageId || !familyName || !contactEmail || !contactPhone || !guestOfName) {
    throw new Error("Name, email, phone, and guest-of are required.");
  }
  if (!EMAIL_RE.test(contactEmail)) throw new Error("Enter a valid email address.");
  if (affiliationRaw !== "PACK" && affiliationRaw !== "TROOP") throw new Error("Choose Pack 376 or Troop 376.");
  if (payingCount === null || freeCount === null) throw new Error("Invalid attendee counts.");
  if (payingCount + freeCount === 0) throw new Error("Enter at least one attendee.");

  const trip = await prisma.tripPage.findUnique({ where: { id: tripPageId } });
  if (!trip) throw new Error("Trip not found.");

  // Priced the same way the public form prices it, so a late addition costs
  // what the tier in effect today costs. Edit the amount afterwards if this
  // family was promised the early-bird rate.
  const amountOwedCents = payingCount * currentTripPriceCents(trip);

  const created = await prisma.tripRegistration.create({
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

  await recordAudit(session, {
    action: "tripRegistration.create",
    summary: `Added the trip registration for ${familyName} by hand${
      registrationClosed(trip) ? " — after the RSVP deadline" : ""
    }`,
    entityType: "TripRegistration",
    entityId: created.id,
    details: [
      { label: "Family name", from: "—", to: familyName },
      { label: "Email", from: "—", to: contactEmail },
      { label: "Attendees", from: "—", to: `${payingCount} paying, ${freeCount} free` },
      { label: "Amount owed", from: "—", to: auditMoney(amountOwedCents) },
    ],
  });

  revalidatePath(ADMIN_PATH);
  revalidatePath(PUBLIC_PATH);
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
