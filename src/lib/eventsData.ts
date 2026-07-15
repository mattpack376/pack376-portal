import "server-only";
import { prisma } from "@/lib/prisma";

function withBalance<T extends { amountOwedCents: number; payments: { amountCents: number }[] }>(reg: T) {
  const paidCents = reg.payments.reduce((sum, p) => sum + p.amountCents, 0);
  return { ...reg, paidCents, remainingCents: reg.amountOwedCents - paidCents };
}

export async function getEvents() {
  const events = await prisma.event.findMany({
    include: { registrations: { include: { payments: true } } },
    orderBy: { eventDate: "desc" },
  });

  return events.map((event) => {
    const registrations = event.registrations.map(withBalance);
    return {
      id: event.id,
      title: event.title,
      category: event.category,
      eventDate: event.eventDate,
      description: event.description,
      feeCents: event.feeCents,
      registrationCount: registrations.length,
      totalOwedCents: registrations.reduce((sum, r) => sum + r.amountOwedCents, 0),
      totalPaidCents: registrations.reduce((sum, r) => sum + r.paidCents, 0),
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
    registrations: event.registrations.map((reg) => ({
      ...withBalance(reg),
      scout: { id: reg.scout.id, firstName: reg.scout.firstName, lastName: reg.scout.lastName, den: reg.scout.den },
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
