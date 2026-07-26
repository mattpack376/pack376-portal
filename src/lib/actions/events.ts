"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertEventPaymentDenAccess, assertEventPaymentAccess } from "@/lib/authorize";
import type { DeadlineCategory } from "@/generated/prisma/enums";

function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export async function createEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const title = String(formData.get("title") || "").trim();
  const category = String(formData.get("category") || "GENERAL") as DeadlineCategory;
  const eventDateRaw = String(formData.get("eventDate") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const feeRaw = String(formData.get("fee") || "");
  const adultFeeRaw = String(formData.get("adultFee") || "");
  const guestChildFeeRaw = String(formData.get("guestChildFee") || "");
  if (!title || !eventDateRaw) throw new Error("Title and event date are required.");

  const eventDate = new Date(`${eventDateRaw}T00:00:00Z`);
  if (Number.isNaN(eventDate.getTime())) throw new Error("Invalid event date.");

  const feeCents = feeRaw.trim() ? dollarsToCents(feeRaw) : null;
  if (feeRaw.trim() && feeCents === null) throw new Error("Invalid fee amount.");

  const adultFeeCents = adultFeeRaw.trim() ? dollarsToCents(adultFeeRaw) : null;
  if (adultFeeRaw.trim() && adultFeeCents === null) throw new Error("Invalid adult fee amount.");

  const guestChildFeeCents = guestChildFeeRaw.trim() ? dollarsToCents(guestChildFeeRaw) : null;
  if (guestChildFeeRaw.trim() && guestChildFeeCents === null) throw new Error("Invalid guest child fee amount.");

  const event = await prisma.event.create({
    data: { title, category, eventDate, description: description || null, feeCents, adultFeeCents, guestChildFeeCents },
  });

  revalidatePath("/portal/admin/events");
  redirect(`/portal/admin/events/${event.id}`);
}

export async function updateEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const category = String(formData.get("category") || "GENERAL") as DeadlineCategory;
  const eventDateRaw = String(formData.get("eventDate") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const feeRaw = String(formData.get("fee") || "");
  const adultFeeRaw = String(formData.get("adultFee") || "");
  const guestChildFeeRaw = String(formData.get("guestChildFee") || "");
  if (!id || !title || !eventDateRaw) throw new Error("Title and event date are required.");

  const eventDate = new Date(`${eventDateRaw}T00:00:00Z`);
  if (Number.isNaN(eventDate.getTime())) throw new Error("Invalid event date.");

  const feeCents = feeRaw.trim() ? dollarsToCents(feeRaw) : null;
  if (feeRaw.trim() && feeCents === null) throw new Error("Invalid fee amount.");

  const adultFeeCents = adultFeeRaw.trim() ? dollarsToCents(adultFeeRaw) : null;
  if (adultFeeRaw.trim() && adultFeeCents === null) throw new Error("Invalid adult fee amount.");

  const guestChildFeeCents = guestChildFeeRaw.trim() ? dollarsToCents(guestChildFeeRaw) : null;
  if (guestChildFeeRaw.trim() && guestChildFeeCents === null) throw new Error("Invalid guest child fee amount.");

  await prisma.event.update({
    where: { id },
    data: { title, category, eventDate, description: description || null, feeCents, adultFeeCents, guestChildFeeCents },
  });

  revalidatePath(`/portal/admin/events/${id}`);
  revalidatePath("/portal/admin/events");
}

export async function deleteEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const id = String(formData.get("id") || "");
  if (!id) throw new Error("Missing event id.");

  await prisma.event.delete({ where: { id } });

  revalidatePath("/portal/admin/events");
  redirect("/portal/admin/events");
}

export async function registerScoutForEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const eventId = String(formData.get("eventId") || "");
  const scoutIds = formData.getAll("scoutId").map(String).filter(Boolean);
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));
  if (!eventId || scoutIds.length === 0 || amountOwedCents === null) {
    throw new Error("At least one scout and a valid amount owed are required.");
  }

  const existing = await prisma.eventRegistration.findMany({
    where: { eventId, scoutId: { in: scoutIds } },
    select: { scoutId: true },
  });
  const alreadyRegistered = new Set(existing.map((r) => r.scoutId));
  const newScoutIds = scoutIds.filter((id) => !alreadyRegistered.has(id));
  if (newScoutIds.length === 0) throw new Error("Those scouts are already registered for this event.");

  await prisma.eventRegistration.createMany({
    data: newScoutIds.map((scoutId) => ({ eventId, scoutId, amountOwedCents })),
  });

  revalidatePath(`/portal/admin/events/${eventId}`);
}

export async function updateRegistrationAmountAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const registrationId = String(formData.get("registrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));
  if (!registrationId || amountOwedCents === null) {
    throw new Error("A valid amount owed is required.");
  }

  const registration = await prisma.eventRegistration.findUnique({
    where: { id: registrationId },
    select: { scout: { select: { denId: true } } },
  });
  if (!registration) throw new Error("Registration not found.");
  assertEventPaymentDenAccess(session, registration.scout.denId);

  await prisma.eventRegistration.update({
    where: { id: registrationId },
    data: { amountOwedCents },
  });

  revalidatePath(`/portal/admin/events/${eventId}/${registrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function removeRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const registrationId = String(formData.get("registrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  if (!registrationId) throw new Error("Missing registration id.");

  await prisma.eventRegistration.delete({ where: { id: registrationId } });

  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function addEventPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const registrationId = String(formData.get("registrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  const paidOnRaw = String(formData.get("paidOn") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  if (!registrationId || amountCents === null || amountCents === 0) {
    throw new Error("A valid payment amount is required.");
  }

  const registration = await prisma.eventRegistration.findUnique({
    where: { id: registrationId },
    select: { scout: { select: { denId: true } } },
  });
  if (!registration) throw new Error("Registration not found.");
  assertEventPaymentDenAccess(session, registration.scout.denId);

  const paidOn = paidOnRaw ? new Date(paidOnRaw) : new Date();
  if (Number.isNaN(paidOn.getTime())) throw new Error("Invalid payment date.");

  await prisma.eventPayment.create({
    data: { eventRegistrationId: registrationId, amountCents, paidOn, note, recordedByUserId: session.userId },
  });

  revalidatePath(`/portal/admin/events/${eventId}/${registrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function registerMyScoutsForEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  if (session.role !== "PARENT") throw new Error("Not authorized.");

  const eventId = String(formData.get("eventId") || "");
  const scoutIds = formData.getAll("scoutId").map(String).filter(Boolean);
  if (!eventId || scoutIds.length === 0) throw new Error("Select at least one scout.");

  const allowedScoutIds = new Set(session.scoutIds);
  if (!scoutIds.every((id) => allowedScoutIds.has(id))) {
    throw new Error("Not authorized for one or more of those scouts.");
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { feeCents: true } });
  if (!event || event.feeCents === null) throw new Error("This event isn't open for self-registration.");

  const existing = await prisma.eventRegistration.findMany({
    where: { eventId, scoutId: { in: scoutIds } },
    select: { scoutId: true },
  });
  const alreadyRegistered = new Set(existing.map((r) => r.scoutId));
  const newScoutIds = scoutIds.filter((id) => !alreadyRegistered.has(id));
  if (newScoutIds.length === 0) throw new Error("Already registered for this event.");

  await prisma.eventRegistration.createMany({
    data: newScoutIds.map((scoutId) => ({ eventId, scoutId, amountOwedCents: event.feeCents! })),
  });

  revalidatePath("/portal/parent");
}

function parseCount(raw: FormDataEntryValue | null): number | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return 0;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

// Self-registration as a guest group (a family or a leader bringing guests)
// is open to any signed-in role (parent, den leader, admin) — everyone signs
// up the same way; ownership (addedByUserId) is what lets someone edit their
// own entry later, not their role.
export async function registerMyGuestGroupForEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const eventId = String(formData.get("eventId") || "");
  const familyName = String(formData.get("familyName") || "").trim();
  const adultCount = parseCount(formData.get("adultCount"));
  const childCount = parseCount(formData.get("childCount"));
  if (!eventId || !familyName || adultCount === null || childCount === null) {
    throw new Error("A name and valid adult/child counts are required.");
  }
  if (adultCount + childCount === 0) throw new Error("Enter at least one adult or child.");

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { adultFeeCents: true, guestChildFeeCents: true },
  });
  if (!event) throw new Error("Event not found.");
  if (adultCount > 0 && event.adultFeeCents === null) {
    throw new Error("This event isn't open for adult guest self-registration.");
  }
  if (childCount > 0 && event.guestChildFeeCents === null) {
    throw new Error("This event isn't open for guest child self-registration.");
  }

  const amountOwedCents = adultCount * (event.adultFeeCents ?? 0) + childCount * (event.guestChildFeeCents ?? 0);

  await prisma.eventGuestGroup.create({
    data: {
      eventId,
      familyName,
      adultCount,
      childCount,
      amountOwedCents,
      addedByUserId: session.userId,
      // Self-registration is inherently "attending as/with yourself" —
      // there's no separate scout/leader picker on this form the way the
      // admin's manual-entry form has one.
      guestOfUserId: session.userId,
    },
  });

  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster/family-view");
}

export async function removeMyGuestGroupAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const guestGroupId = String(formData.get("guestGroupId") || "");
  if (!guestGroupId) throw new Error("Missing guest group id.");

  const group = await prisma.eventGuestGroup.findUnique({
    where: { id: guestGroupId },
    select: { addedByUserId: true },
  });
  if (!group || group.addedByUserId !== session.userId) throw new Error("Not authorized for this guest group.");

  await prisma.eventGuestGroup.delete({ where: { id: guestGroupId } });

  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster/family-view");
}

export async function deleteEventPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const paymentId = String(formData.get("paymentId") || "");
  const registrationId = String(formData.get("registrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  // Look up den access from the payment's own registration — never trust a
  // client-submitted registrationId for this check, since it travels in the
  // same form as (and independently of) paymentId.
  const payment = await prisma.eventPayment.findUnique({
    where: { id: paymentId },
    select: { eventRegistration: { select: { id: true, scout: { select: { denId: true } } } } },
  });
  if (!payment || payment.eventRegistration.id !== registrationId) throw new Error("Payment not found.");
  assertEventPaymentDenAccess(session, payment.eventRegistration.scout.denId);

  await prisma.eventPayment.delete({ where: { id: paymentId } });

  revalidatePath(`/portal/admin/events/${eventId}/${registrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

// Guest groups aren't tied to a den the way scouts are, so managing them —
// unlike the scout registration/payment actions above — is admin-only for
// creation; there's no den-scoped equivalent of assertEventPaymentDenAccess
// for guests. Editing amounts and recording payments is open to any den
// login (assertEventPaymentAccess), same as it is for adult attendees.

/** Parses a "Guest Of" <select> value of the form "scout:<id>" | "user:<id>" | "" into the two mutually-exclusive FK fields. */
function parseGuestOf(raw: FormDataEntryValue | null): { guestOfScoutId: string | null; guestOfUserId: string | null } {
  const value = String(raw || "");
  if (value.startsWith("scout:")) return { guestOfScoutId: value.slice(6), guestOfUserId: null };
  if (value.startsWith("user:")) return { guestOfScoutId: null, guestOfUserId: value.slice(5) };
  return { guestOfScoutId: null, guestOfUserId: null };
}

export async function addGuestGroupAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const eventId = String(formData.get("eventId") || "");
  const familyName = String(formData.get("familyName") || "").trim();
  const adultCount = parseCount(formData.get("adultCount"));
  const childCount = parseCount(formData.get("childCount"));
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));
  const { guestOfScoutId, guestOfUserId } = parseGuestOf(formData.get("guestOf"));
  if (!eventId || !familyName || adultCount === null || childCount === null || amountOwedCents === null) {
    throw new Error("A name, valid adult/child counts, and a valid amount owed are required.");
  }
  if (adultCount + childCount === 0) throw new Error("Enter at least one adult or child.");

  await prisma.eventGuestGroup.create({
    data: { eventId, familyName, adultCount, childCount, amountOwedCents, guestOfScoutId, guestOfUserId },
  });

  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events/guests");
}

export async function updateGuestGroupAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertEventPaymentAccess(session);

  const guestGroupId = String(formData.get("guestGroupId") || "");
  const eventId = String(formData.get("eventId") || "");
  const familyName = String(formData.get("familyName") || "").trim();
  const adultCount = parseCount(formData.get("adultCount"));
  const childCount = parseCount(formData.get("childCount"));
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));
  const { guestOfScoutId, guestOfUserId } = parseGuestOf(formData.get("guestOf"));
  if (!guestGroupId || !familyName || adultCount === null || childCount === null || amountOwedCents === null) {
    throw new Error("A name, valid adult/child counts, and a valid amount owed are required.");
  }
  if (adultCount + childCount === 0) throw new Error("Enter at least one adult or child.");

  await prisma.eventGuestGroup.update({
    where: { id: guestGroupId },
    data: { familyName, adultCount, childCount, amountOwedCents, guestOfScoutId, guestOfUserId },
  });

  revalidatePath(`/portal/admin/events/${eventId}/guests/${guestGroupId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
  revalidatePath("/portal/admin/events/guests");
}

export async function removeGuestGroupAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const guestGroupId = String(formData.get("guestGroupId") || "");
  const eventId = String(formData.get("eventId") || "");
  if (!guestGroupId) throw new Error("Missing guest group id.");

  await prisma.eventGuestGroup.delete({ where: { id: guestGroupId } });

  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function addGuestGroupPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertEventPaymentAccess(session);

  const guestGroupId = String(formData.get("guestGroupId") || "");
  const eventId = String(formData.get("eventId") || "");
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  const paidOnRaw = String(formData.get("paidOn") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  if (!guestGroupId || amountCents === null || amountCents === 0) {
    throw new Error("A valid payment amount is required.");
  }

  const paidOn = paidOnRaw ? new Date(paidOnRaw) : new Date();
  if (Number.isNaN(paidOn.getTime())) throw new Error("Invalid payment date.");

  await prisma.eventGuestGroupPayment.create({
    data: { eventGuestGroupId: guestGroupId, amountCents, paidOn, note, recordedByUserId: session.userId },
  });

  revalidatePath(`/portal/admin/events/${eventId}/guests/${guestGroupId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function deleteGuestGroupPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertEventPaymentAccess(session);

  const paymentId = String(formData.get("paymentId") || "");
  const guestGroupId = String(formData.get("guestGroupId") || "");
  const eventId = String(formData.get("eventId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  const payment = await prisma.eventGuestGroupPayment.findUnique({
    where: { id: paymentId },
    select: { eventGuestGroupId: true },
  });
  if (!payment || payment.eventGuestGroupId !== guestGroupId) throw new Error("Payment not found.");

  await prisma.eventGuestGroupPayment.delete({ where: { id: paymentId } });

  revalidatePath(`/portal/admin/events/${eventId}/guests/${guestGroupId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}
