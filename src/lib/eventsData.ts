import "server-only";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import { ROLE_LABELS } from "@/lib/roleLabels";
import type { Rank } from "@/generated/prisma/enums";

function withBalance<T extends { amountOwedCents: number; payments: { amountCents: number }[] }>(reg: T) {
  const paidCents = reg.payments.reduce((sum, p) => sum + p.amountCents, 0);
  return { ...reg, paidCents, remainingCents: reg.amountOwedCents - paidCents };
}

const guestOfScoutSelect = {
  select: { id: true, firstName: true, lastName: true },
} as const;
const guestOfUserSelect = { select: { id: true, displayName: true } } as const;

/** "Timmy Test" or "Jane Smith" — just the name, no role/den qualifier, since the guest-of column is the only place this is shown. */
function guestOfLabel(group: {
  guestOfScout: { firstName: string; lastName: string } | null;
  guestOfUser: { displayName: string } | null;
}) {
  if (group.guestOfScout) return `${group.guestOfScout.firstName} ${group.guestOfScout.lastName}`;
  if (group.guestOfUser) return group.guestOfUser.displayName;
  return null;
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
          guestOfScout: guestOfScoutSelect,
          guestOfUser: guestOfUserSelect,
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
      guestOfScoutId: group.guestOfScoutId,
      guestOfUserId: group.guestOfUserId,
      guestOfLabel: guestOfLabel(group),
    })),
  };
}

export async function getGuestGroupDetail(guestGroupId: string) {
  const group = await prisma.eventGuestGroup.findUnique({
    where: { id: guestGroupId },
    include: {
      event: true,
      guestOfScout: guestOfScoutSelect,
      guestOfUser: guestOfUserSelect,
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
    guestOfScoutId: group.guestOfScoutId,
    guestOfUserId: group.guestOfUserId,
    guestOfLabel: guestOfLabel(group),
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
    include: {
      event: true,
      payments: true,
      addedByUser: { select: { displayName: true } },
      guestOfScout: guestOfScoutSelect,
      guestOfUser: guestOfUserSelect,
    },
    orderBy: { event: { eventDate: "asc" } },
  });

  return groups.map((group) => ({
    ...withBalance(group),
    event: group.event,
    addedByDisplayName: group.addedByUser?.displayName ?? null,
    guestOfScoutId: group.guestOfScoutId,
    guestOfUserId: group.guestOfUserId,
    guestOfLabel: guestOfLabel(group),
  }));
}

/**
 * Every scout registration for any event, pack-wide — used alongside
 * getAllGuestGroups so the pack-wide "export guests" CSV also includes
 * scouts registered directly via EventRegistration, not just manually-added
 * guest groups.
 */
export async function getAllRegistrations() {
  const registrations = await prisma.eventRegistration.findMany({
    include: {
      event: true,
      payments: true,
      scout: { include: { den: true } },
    },
    orderBy: [{ event: { eventDate: "asc" } }, { scout: { lastName: "asc" } }, { scout: { firstName: "asc" } }],
  });

  return registrations.map((reg) => ({
    ...withBalance(reg),
    event: reg.event,
    scout: { id: reg.scout.id, firstName: reg.scout.firstName, lastName: reg.scout.lastName, den: reg.scout.den },
  }));
}

/**
 * Every scout (grouped by den) and every non-parent staff account — used to
 * populate the "Guest Of" picker on the admin add/edit guest group forms, so
 * a guest can be linked to the scout or leader/admin they're attending with.
 */
export async function getGuestOfOptions() {
  const [dens, staff] = await Promise.all([
    prisma.den.findMany({
      include: { scouts: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }] } },
    }),
    prisma.user.findMany({
      where: { role: { not: "PARENT" } },
      select: { id: true, displayName: true, role: true },
      orderBy: [{ role: "asc" }, { displayName: "asc" }],
    }),
  ]);

  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });

  return {
    densWithScouts: dens
      .map((den) => ({ id: den.id, label: denDisplayName(den.rank, den.scoutingYear, den.label), scouts: den.scouts }))
      .filter((d) => d.scouts.length > 0),
    staff: staff.map((u) => ({ id: u.id, label: `${u.displayName} (${ROLE_LABELS[u.role] ?? u.role})` })),
  };
}
