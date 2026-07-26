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
  if (!title || !eventDateRaw) throw new Error("Title and event date are required.");

  const eventDate = new Date(`${eventDateRaw}T00:00:00Z`);
  if (Number.isNaN(eventDate.getTime())) throw new Error("Invalid event date.");

  const feeCents = feeRaw.trim() ? dollarsToCents(feeRaw) : null;
  if (feeRaw.trim() && feeCents === null) throw new Error("Invalid fee amount.");

  const adultFeeCents = adultFeeRaw.trim() ? dollarsToCents(adultFeeRaw) : null;
  if (adultFeeRaw.trim() && adultFeeCents === null) throw new Error("Invalid adult fee amount.");

  const event = await prisma.event.create({
    data: { title, category, eventDate, description: description || null, feeCents, adultFeeCents },
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
  if (!id || !title || !eventDateRaw) throw new Error("Title and event date are required.");

  const eventDate = new Date(`${eventDateRaw}T00:00:00Z`);
  if (Number.isNaN(eventDate.getTime())) throw new Error("Invalid event date.");

  const feeCents = feeRaw.trim() ? dollarsToCents(feeRaw) : null;
  if (feeRaw.trim() && feeCents === null) throw new Error("Invalid fee amount.");

  const adultFeeCents = adultFeeRaw.trim() ? dollarsToCents(adultFeeRaw) : null;
  if (adultFeeRaw.trim() && adultFeeCents === null) throw new Error("Invalid adult fee amount.");

  await prisma.event.update({
    where: { id },
    data: { title, category, eventDate, description: description || null, feeCents, adultFeeCents },
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

// Self-registration as an attending adult is open to any signed-in role
// (parent, den leader, admin) — everyone can sign themselves up the same
// way; ownership (addedByUserId) is what lets someone edit their own entry
// later, not their role.
export async function registerMyAdultForEventAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const eventId = String(formData.get("eventId") || "");
  const name = String(formData.get("name") || "").trim();
  if (!eventId || !name) throw new Error("A name is required.");

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { adultFeeCents: true } });
  if (!event || event.adultFeeCents === null) throw new Error("This event isn't open for adult self-registration.");

  await prisma.eventAdultRegistration.create({
    data: { eventId, name, amountOwedCents: event.adultFeeCents, addedByUserId: session.userId },
  });

  revalidatePath("/portal/parent");
  revalidatePath("/portal/roster/family-view");
}

export async function removeMyAdultRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");

  const adultRegistrationId = String(formData.get("adultRegistrationId") || "");
  if (!adultRegistrationId) throw new Error("Missing registration id.");

  const reg = await prisma.eventAdultRegistration.findUnique({
    where: { id: adultRegistrationId },
    select: { addedByUserId: true },
  });
  if (!reg || reg.addedByUserId !== session.userId) throw new Error("Not authorized for this registration.");

  await prisma.eventAdultRegistration.delete({ where: { id: adultRegistrationId } });

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

// Adult attendees aren't tied to a den (unlike scouts), so managing them —
// unlike the scout registration/payment actions above — is admin-only; there's
// no den-scoped equivalent of assertEventPaymentDenAccess for adults.

export async function addAdultRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const eventId = String(formData.get("eventId") || "");
  const name = String(formData.get("name") || "").trim();
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));
  if (!eventId || !name || amountOwedCents === null) {
    throw new Error("A name and a valid amount owed are required.");
  }

  await prisma.eventAdultRegistration.create({
    data: { eventId, name, amountOwedCents },
  });

  revalidatePath(`/portal/admin/events/${eventId}`);
}

export async function updateAdultRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertEventPaymentAccess(session);

  const adultRegistrationId = String(formData.get("adultRegistrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  const name = String(formData.get("name") || "").trim();
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));
  if (!adultRegistrationId || !name || amountOwedCents === null) {
    throw new Error("A name and a valid amount owed are required.");
  }

  await prisma.eventAdultRegistration.update({
    where: { id: adultRegistrationId },
    data: { name, amountOwedCents },
  });

  revalidatePath(`/portal/admin/events/${eventId}/adult/${adultRegistrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function removeAdultRegistrationAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertAdmin(session);

  const adultRegistrationId = String(formData.get("adultRegistrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  if (!adultRegistrationId) throw new Error("Missing registration id.");

  await prisma.eventAdultRegistration.delete({ where: { id: adultRegistrationId } });

  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function addAdultEventPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertEventPaymentAccess(session);

  const adultRegistrationId = String(formData.get("adultRegistrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  const amountCents = dollarsToCents(String(formData.get("amount") || ""));
  const paidOnRaw = String(formData.get("paidOn") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  if (!adultRegistrationId || amountCents === null || amountCents === 0) {
    throw new Error("A valid payment amount is required.");
  }

  const paidOn = paidOnRaw ? new Date(paidOnRaw) : new Date();
  if (Number.isNaN(paidOn.getTime())) throw new Error("Invalid payment date.");

  await prisma.eventAdultPayment.create({
    data: { eventAdultRegistrationId: adultRegistrationId, amountCents, paidOn, note, recordedByUserId: session.userId },
  });

  revalidatePath(`/portal/admin/events/${eventId}/adult/${adultRegistrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}

export async function deleteAdultEventPaymentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not authorized.");
  assertEventPaymentAccess(session);

  const paymentId = String(formData.get("paymentId") || "");
  const adultRegistrationId = String(formData.get("adultRegistrationId") || "");
  const eventId = String(formData.get("eventId") || "");
  if (!paymentId) throw new Error("Missing payment id.");

  const payment = await prisma.eventAdultPayment.findUnique({
    where: { id: paymentId },
    select: { eventAdultRegistrationId: true },
  });
  if (!payment || payment.eventAdultRegistrationId !== adultRegistrationId) throw new Error("Payment not found.");

  await prisma.eventAdultPayment.delete({ where: { id: paymentId } });

  revalidatePath(`/portal/admin/events/${eventId}/adult/${adultRegistrationId}`);
  revalidatePath(`/portal/admin/events/${eventId}`);
  revalidatePath("/portal/admin/events");
}
