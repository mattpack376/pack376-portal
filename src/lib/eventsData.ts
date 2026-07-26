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
      guestGroups: { include: { payments: true } },
    },
    orderBy: { eventDate: "desc" },
  });

  return events.map((event) => {
    const registrations = event.registrations.map(withBalance);
    const guestGroups = event.guestGroups.map(withBalance);
    return {
      id: event.id,
      title: event.title,
      category: event.category,
      eventDate: event.eventDate,
      description: event.description,
      feeCents: event.feeCents,
      adultFeeCents: event.adultFeeCents,
      guestChildFeeCents: event.guestChildFeeCents,
      registrationCount: registrations.length,
      guestAdultCount: guestGroups.reduce((sum, g) => sum + g.adultCount, 0),
      guestChildCount: guestGroups.reduce((sum, g) => sum + g.childCount, 0),
      totalOwedCents:
        registrations.reduce((sum, r) => sum + r.amountOwedCents, 0) +
        guestGroups.reduce((sum, g) => sum + g.amountOwedCents, 0),
      totalPaidCents:
        registrations.reduce((sum, r) => sum + r.paidCents, 0) +
        guestGroups.reduce((sum, g) => sum + g.paidCents, 0),
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
      guestGroups: {
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
    guestChildFeeCents: event.guestChildFeeCents,
    registrations: event.registrations.map((reg) => ({
      ...withBalance(reg),
      scout: { id: reg.scout.id, firstName: reg.scout.firstName, lastName: reg.scout.lastName, den: reg.scout.den },
    })),
    guestGroups: event.guestGroups.map((group) => ({
      ...withBalance(group),
      addedByDisplayName: group.addedByUser?.displayName ?? null,
    })),
  };
}

export async function getGuestGroupDetail(guestGroupId: string) {
  const group = await prisma.eventGuestGroup.findUnique({
    where: { id: guestGroupId },
    include: {
      event: true,
      payments: {
        orderBy: { paidOn: "desc" },
        include: { recordedByUser: { select: { username: true } } },
      },
    },
  });
  if (!group) return null;

  const paidCents = group.payments.reduce((sum, p) => sum + p.amountCents, 0);

  return {
    id: group.id,
    familyName: group.familyName,
    adultCount: group.adultCount,
    childCount: group.childCount,
    amountOwedCents: group.amountOwedCents,
    paidCents,
    remainingCents: group.amountOwedCents - paidCents,
    event: group.event,
    payments: group.payments.map((p) => ({
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

/** Every event a given user has registered a guest group for — used by the Parent Dashboard's Event Payments section alongside getScoutEventBalances. */
export async function getGuestGroupBalances(userId: string) {
  const groups = await prisma.eventGuestGroup.findMany({
    where: { addedByUserId: userId },
    include: { event: true, payments: true },
    orderBy: { event: { eventDate: "asc" } },
  });

  return groups.map((group) => ({
    ...withBalance(group),
    event: group.event,
  }));
}

/**
 * Upcoming events someone can self-register a guest group for — used by the
 * Parent Dashboard's "Register for Events" section (scoutIds + own guest
 * groups) and by Family View's self-registration section for den
 * leaders/admins (scoutIds: [], own guest groups only). An event only shows
 * up here once it has a default fee set (scout, adult, and/or guest child);
 * without one for a given category, self-service for that category can't
 * know what to charge and an admin has to register people manually with a
 * custom amount.
 */
export async function getOpenEventsForSelfRegistration(scoutIds: string[], userId: string) {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const events = await prisma.event.findMany({
    where: {
      eventDate: { gte: todayUtc },
      OR: [{ feeCents: { not: null } }, { adultFeeCents: { not: null } }, { guestChildFeeCents: { not: null } }],
    },
    include: {
      registrations: {
        where: { scoutId: { in: scoutIds } },
        select: { scoutId: true },
      },
      guestGroups: {
        select: {
          id: true,
          familyName: true,
          adultCount: true,
          childCount: true,
          amountOwedCents: true,
          addedByUserId: true,
          payments: { select: { amountCents: true } },
        },
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
    guestChildFeeCents: event.guestChildFeeCents,
    registeredScoutIds: event.registrations.map((r) => r.scoutId),
    myGuestGroups: event.guestGroups
      .filter((g) => g.addedByUserId === userId)
      .map((g) => ({
        id: g.id,
        familyName: g.familyName,
        adultCount: g.adultCount,
        childCount: g.childCount,
        amountOwedCents: g.amountOwedCents,
        paidCents: g.payments.reduce((sum, p) => sum + p.amountCents, 0),
      })),
  }));
}

/**
 * Every guest group registered for any event, pack-wide — used by Family
 * View for admins/den leaders to record payments. Guest groups aren't tied
 * to a den (unlike scouts), so unlike getScoutEventBalances this isn't
 * scoped by scoutIds.
 */
export async function getAllGuestGroups() {
  const groups = await prisma.eventGuestGroup.findMany({
    include: { event: true, payments: true },
    orderBy: { event: { eventDate: "asc" } },
  });

  return groups.map((group) => ({
    ...withBalance(group),
    event: group.event,
  }));
}
