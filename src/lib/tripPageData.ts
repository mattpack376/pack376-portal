import "server-only";
import { prisma } from "@/lib/prisma";
import type { TripDay, TripMealType } from "@/generated/prisma/enums";

/** Only one trip page exists today (Camp Conron), but every lookup below is keyed by slug so a future trip's micro-site can reuse this same model without a schema change. */
export const CAMP_CONRON_SLUG = "camp-conron";

const MEAL_SLOTS: { day: TripDay; mealType: TripMealType; sortOrder: number }[] = [
  { day: "FRIDAY", mealType: "DINNER", sortOrder: 0 },
  { day: "SATURDAY", mealType: "BREAKFAST", sortOrder: 1 },
  { day: "SATURDAY", mealType: "LUNCH", sortOrder: 2 },
  { day: "SATURDAY", mealType: "DINNER", sortOrder: 3 },
  { day: "SUNDAY", mealType: "BREAKFAST", sortOrder: 4 },
  { day: "SUNDAY", mealType: "LUNCH", sortOrder: 5 },
  { day: "SUNDAY", mealType: "DINNER", sortOrder: 6 },
  { day: "MONDAY", mealType: "BREAKFAST", sortOrder: 7 },
];

export const DAY_LABELS: Record<TripDay, string> = {
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
  MONDAY: "Monday",
};

/** Chronological order for this trip's four days — used to sort TripActivity rows without depending on Postgres enum-ordering semantics, same idiom as RANK_ORDER in rankConfig.ts. */
export const TRIP_DAY_ORDER: TripDay[] = ["FRIDAY", "SATURDAY", "SUNDAY", "MONDAY"];

export const MEAL_TYPE_LABELS: Record<TripMealType, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
};

/**
 * Fetches the singleton TripPage row for `slug`, creating it — seeded with
 * the Camp Conron Halloween Weekend flyer's details and the 8 fixed meal
 * slots — the first time it's requested. Every field is editable afterward
 * from /portal/admin/camp-conron.
 */
export async function getOrCreateTripPage(slug: string) {
  const existing = await prisma.tripPage.findUnique({ where: { slug } });
  if (existing) return existing;

  return prisma.tripPage.create({
    data: {
      slug,
      title: "Camp Conron Halloween Weekend",
      location: "Holmes, NY",
      startDate: new Date("2026-10-09T00:00:00Z"),
      endDate: new Date("2026-10-12T00:00:00Z"),
      detailsHtml:
        "A joint camping weekend for Pack 376 and Troop 376 at Camp Conron. Bring your best tent decorations for the Halloween tent decorating contest!",
      regularPriceCents: 5500,
      earlyBirdPriceCents: 4500,
      earlyBirdDeadline: new Date("2026-09-25T00:00:00Z"),
      rsvpDeadline: new Date("2026-10-02T00:00:00Z"),
      freeAgeAndUnder: 4,
      packPaymentInstructions: "Payments to Dianaliz or Matt by Cash or Zelle.",
      troopPaymentInstructions: "Payments to Andrew, or any adult leader designated by the Troop.",
      meals: { create: MEAL_SLOTS },
    },
  });
}

export async function getTripMeals(tripPageId: string) {
  return prisma.tripMeal.findMany({
    where: { tripPageId },
    orderBy: { sortOrder: "asc" },
  });
}

/** All duty slots for the trip, sorted by their linked meal's chronological slot (TripMeal.sortOrder already encodes day + meal type), then their own sortOrder/creation order. General duties (no linked meal) sort last, in creation order. */
export async function getTripDutySlots(tripPageId: string) {
  const dutySlots = await prisma.tripDutySlot.findMany({
    where: { tripPageId },
    include: { tripMeal: true },
  });

  return dutySlots.sort((a, b) => {
    const aMealOrder = a.tripMeal?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bMealOrder = b.tripMeal?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aMealOrder !== bMealOrder) return aMealOrder - bMealOrder;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/** All schedule entries for the trip, sorted chronologically (day, then sortOrder, then creation order) rather than trusting DB-level enum ordering. */
export async function getTripActivities(tripPageId: string) {
  const activities = await prisma.tripActivity.findMany({ where: { tripPageId } });
  return activities.sort((a, b) => {
    const dayDiff = TRIP_DAY_ORDER.indexOf(a.day) - TRIP_DAY_ORDER.indexOf(b.day);
    if (dayDiff !== 0) return dayDiff;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export async function getTripRegistrations(tripPageId: string) {
  const registrations = await prisma.tripRegistration.findMany({
    where: { tripPageId },
    include: { payments: { orderBy: { paidOn: "desc" }, include: { recordedByUser: { select: { username: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  return registrations.map((reg) => {
    const paidCents = reg.payments.reduce((sum, p) => sum + p.amountCents, 0);
    return { ...reg, paidCents, remainingCents: reg.amountOwedCents - paidCents };
  });
}

/**
 * Whichever price tier is active right now — early-bird through the end of
 * its deadline day (inclusive), regular price otherwise. Only used to show
 * the "current price" and to freeze a new registration's amountOwedCents;
 * existing registrations keep whatever amount they were charged at signup.
 */
export function currentTripPriceCents(
  trip: { regularPriceCents: number; earlyBirdPriceCents: number | null; earlyBirdDeadline: Date | null },
  now: Date = new Date(),
): number {
  if (trip.earlyBirdPriceCents != null && trip.earlyBirdDeadline) {
    const deadlineEndOfDay = new Date(trip.earlyBirdDeadline);
    deadlineEndOfDay.setUTCHours(23, 59, 59, 999);
    if (now <= deadlineEndOfDay) return trip.earlyBirdPriceCents;
  }
  return trip.regularPriceCents;
}
