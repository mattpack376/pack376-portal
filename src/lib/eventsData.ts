import "server-only";
import { prisma } from "@/lib/prisma";

function withBalance<T extends { amountOwedCents: number; payments: { amountCents: number }[] }>(reg: T) {
  const paidCents = reg.payments.reduce((sum, p) => sum + p.amountCents, 0);
  return { ...reg, paidCents, remainingCents: reg.amountOwedCents - paidCents };
}

export async function getEvents() {
  const events = await prisma.event.findMany({
    include: {
      registrations: { include: { payments: true } },
      adultRegistrations: { include: { payments: true } },
    },
    orderBy: { eventDate: "desc" },
  });

  return events.map((event) => {
    const registrations = event.registrations.map(withBalance);
    const adultRegistrations = event.adultRegistrations.map(withBalance);
    return {
      id: event.id,
      title: event.title,
      category: event.category,
      eventDate: event.eventDate,
      description: event.description,
      feeCents: event.feeCents,
      adultFeeCents: event.adultFeeCents,
      registrationCount: registrations.length,
      adultRegistrationCount: adultRegistrations.length,
      totalOwedCents:
        registrations.reduce((sum, r) => sum + r.amountOwedCents, 0) +
        adultRegistrations.reduce((sum, r) => sum + r.amountOwedCents, 0),
      totalPaidCents:
        registrations.reduce((sum, r) => sum + r.paidCents, 0) +
        adultRegistrations.reduce((sum, r) => sum + r.paidCents, 0),
    };
  });
}

export async function getEventDetail(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      registrations: {
        include: {
          payments: true,
          scout: { include: { den: true } },
        },
        orderBy: [{ scout: { lastName: "asc" } }, { scout: { firstName: "asc" } }],
      },
      adultRegistrations: {
        include: {
          payments: true,
          addedByUser: { select: { displayName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!event) return null;

  return {
    id: event.id,
    title: event.title,
    category: event.category,
    eventDate: event.eventDate,
    description: event.description,
    feeCents: event.feeCents,
    adultFeeCents: event.adultFeeCents,
    registrations: event.registrations.map((reg) => ({
      ...withBalance(reg),
      scout: { id: reg.scout.id, firstName: reg.scout.firstName, lastName: reg.scout.lastName, den: reg.scout.den },
    })),
    adultRegistrations: event.adultRegistrations.map((reg) => ({
      ...withBalance(reg),
      addedByDisplayName: reg.addedByUser?.displayName ?? null,
    })),
  };
}

export async function getAdultRegistrationDetail(adultRegistrationId: string) {
  const reg = await prisma.eventAdultRegistration.findUnique({
    where: { id: adultRegistrationId },
    include: {
      event: true,
      payments: {
        orderBy: { paidOn: "desc" },
        include: { recordedByUser: { select: { username: true } } },
      },
    },
  });
  if (!reg) return null;

  const paidCents = reg.payments.reduce((sum, p) => sum + p.amountCents, 0);

  return {
    id: reg.id,
    name: reg.name,
    amountOwedCents: reg.amountOwedCents,
    paidCents,
    remainingCents: reg.amountOwedCents - paidCents,
    event: reg.event,
    payments: reg.payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      paidOn: p.paidOn,
      note: p.note,
      createdAt: p.createdAt,
      recordedByUsername: p.recordedByUser?.username ?? null,
    })),
  };
}

export async function getRegistrationDetail(registrationId: string) {
  const reg = await prisma.eventRegistration.findUnique({
    where: { id: registrationId },
    include: {
      event: true,
      scout: { include: { den: true } },
      payments: {
        orderBy: { paidOn: "desc" },
        include: { recordedByUser: { select: { username: true } } },
      },
    },
  });
  if (!reg) return null;

  const paidCents = reg.payments.reduce((sum, p) => sum + p.amountCents, 0);

  return {
    id: reg.id,
    amountOwedCents: reg.amountOwedCents,
    paidCents,
    remainingCents: reg.amountOwedCents - paidCents,
    event: reg.event,
    scout: { id: reg.scout.id, firstName: reg.scout.firstName, lastName: reg.scout.lastName, den: reg.scout.den },
    payments: reg.payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      paidOn: p.paidOn,
      note: p.note,
      createdAt: p.createdAt,
      recordedByUsername: p.recordedByUser?.username ?? null,
    })),
  };
}

/** Every event a given set of scouts is registered for — used by the Parent Dashboard. */
export async function getScoutEventBalances(scoutIds: string[]) {
  if (scoutIds.length === 0) return [];

  const registrations = await prisma.eventRegistration.findMany({
    where: { scoutId: { in: scoutIds } },
    include: { event: true, payments: true, scout: { select: { firstName: true, lastName: true } } },
    orderBy: { event: { eventDate: "asc" } },
  });

  return registrations.map((reg) => {
    const { paidCents, remainingCents } = withBalance(reg);
    return {
      id: reg.id,
      event: reg.event,
      scoutId: reg.scoutId,
      scoutFirstName: reg.scout.firstName,
      amountOwedCents: reg.amountOwedCents,
      paidCents,
      remainingCents,
    };
  });
}

/**
 * Upcoming events someone can self-register for — used by the Parent
 * Dashboard's "Register for Events" section (scoutIds + own adult entry) and
 * by Family View's self-registration section for den leaders/admins
 * (scoutIds: [], own adult entry only). An event only shows up here once it
 * has a default fee set (scout and/or adult); without one, self-service
 * can't know what to charge and an admin has to register people manually
 * with a custom amount.
 */
export async function getOpenEventsForSelfRegistration(scoutIds: string[], userId: string) {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const events = await prisma.event.findMany({
    where: {
      eventDate: { gte: todayUtc },
      OR: [{ feeCents: { not: null } }, { adultFeeCents: { not: null } }],
    },
    include: {
      registrations: {
        where: { scoutId: { in: scoutIds } },
        select: { scoutId: true },
      },
      adultRegistrations: {
        select: { id: true, name: true, amountOwedCents: true, addedByUserId: true, payments: { select: { amountCents: true } } },
      },
    },
    orderBy: { eventDate: "asc" },
  });

  return events.map((event) => ({
    id: event.id,
    title: event.title,
    category: event.category,
    eventDate: event.eventDate,
    description: event.description,
    feeCents: event.feeCents,
    adultFeeCents: event.adultFeeCents,
    registeredScoutIds: event.registrations.map((r) => r.scoutId),
    adultHeadcount: event.adultRegistrations.length,
    myAdults: event.adultRegistrations
      .filter((a) => a.addedByUserId === userId)
      .map((a) => ({
        id: a.id,
        name: a.name,
        amountOwedCents: a.amountOwedCents,
        paidCents: a.payments.reduce((sum, p) => sum + p.amountCents, 0),
      })),
  }));
}

/**
 * Every adult registered for any event, pack-wide — used by Family View for
 * admins/den leaders to record payments. Adults aren't tied to a den (unlike
 * scouts), so unlike getScoutEventBalances this isn't scoped by scoutIds.
 */
export async function getAllAdultRegistrations() {
  const registrations = await prisma.eventAdultRegistration.findMany({
    include: { event: true, payments: true },
    orderBy: { event: { eventDate: "asc" } },
  });

  return registrations.map((reg) => ({
    ...withBalance(reg),
    event: reg.event,
  }));
}
