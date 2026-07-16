"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertAdmin, assertEventPaymentDenAccess } from "@/lib/authorize";
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
  if (!title || !eventDateRaw) throw new Error("Title and event date are required.");

  const eventDate = new Date(`${eventDateRaw}T00:00:00Z`);
  if (Number.isNaN(eventDate.getTime())) throw new Error("Invalid event date.");

  const feeCents = feeRaw.trim() ? dollarsToCents(feeRaw) : null;
  if (feeRaw.trim() && feeCents === null) throw new Error("Invalid fee amount.");

  const event = await prisma.event.create({
    data: { title, category, eventDate, description: description || null, feeCents },
  });

  revalidatePath("/portal/admin/events");
  redirect(`/portal/admin/events/${event.id}`);
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
  const scoutId = String(formData.get("scoutId") || "");
  const amountOwedCents = dollarsToCents(String(formData.get("amountOwed") || ""));
  if (!eventId || !scoutId || amountOwedCents === null) {
    throw new Error("A scout and a valid amount owed are required.");
  }

  const existing = await prisma.eventRegistration.findUnique({
    where: { eventId_scoutId: { eventId, scoutId } },
  });
  if (existing) throw new Error("That scout is already registered for this event.");

  await prisma.eventRegistration.create({ data: { eventId, scoutId, amountOwedCents } });

  revalidatePath(`/portal/admin/events/${eventId}`);
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
