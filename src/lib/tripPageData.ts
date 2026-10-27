import "server-only";
import { dateOnlyHasPassed } from "@/lib/dateOnly";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { TripDay, TripMealType } from "@/generated/prisma/enums";
import { CAMP_CONRON_SITE, CYCLONES_SITE, tripSiteBySlug } from "@/lib/tripSites";
import { paymentStatus, paymentRowClass } from "@/lib/paymentStatus";
import { formatCents } from "@/lib/duesData";
import { revalidateTripAdminPages } from "@/lib/tripRevalidate";

/** Every lookup below is keyed by slug, so each event's micro-site (see TRIP_SITES in tripSites.ts) reuses this same model without a schema change. */
export const CAMP_CONRON_SLUG = CAMP_CONRON_SITE.slug;
export const CYCLONES_SLUG = CYCLONES_SITE.slug;

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

/** A typed empty result, for a section an event doesn't have — skips its query without widening the list's type to never[]. */
export function none<Fetch extends (...args: never[]) => Promise<unknown[]>>(): Awaited<ReturnType<Fetch>> {
  return [] as unknown as Awaited<ReturnType<Fetch>>;
}

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

/** A trip date as "Fri, Oct 9, 2026", or null when the date isn't set. */
export function formatTripDate(date: Date | null) {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    date,
  );
}

/**
 * When an event is, as one line: "Fri, Oct 9, 2026 – Mon, Oct 12, 2026" for a
 * multi-day trip, just the start for a one-day event, then " · 6:40 PM" if a
 * time is set. Null when there's no start date to show.
 */
export function formatTripWhen(trip: { startDate: Date | null; endDate: Date | null; timeLabel: string | null }) {
  if (!trip.startDate) return null;
  const dates = trip.endDate
    ? `${formatTripDate(trip.startDate)} – ${formatTripDate(trip.endDate)}`
    : formatTripDate(trip.startDate);
  return trip.timeLabel ? `${dates} · ${trip.timeLabel}` : dates;
}

/**
 * The content a site's TripPage row starts with, the first time its page is
 * requested. Every field is editable afterward from the site's admin page, so
 * these are only a starting point — the Cyclones one is deliberately
 * unpublished with a $0 price until the flyer's real details are entered.
 */
const TRIP_SEEDS: Record<string, Omit<Prisma.TripPageUncheckedCreateInput, "slug">> = {
  [CAMP_CONRON_SLUG]: {
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
  },
  [CYCLONES_SLUG]: {
    title: "Brooklyn Cyclones Overnight",
    location: "Maimonides Park, Brooklyn, NY",
    startDate: new Date("2027-04-23T00:00:00Z"),
    timeLabel: "6:40 PM",
    detailsHtml: "A joint overnight for Pack 376 and Troop 376 at Maimonides Park with the Brooklyn Cyclones.",
    regularPriceCents: 0,
    priceTbd: true,
    packPaymentInstructions: "Payments to Dianaliz or Matt by Cash or Zelle.",
    troopPaymentInstructions: "Payments to Andrew, or any adult leader designated by the Troop.",
    published: false,
  },
};

/**
 * Fetches the singleton TripPage row for `slug`, creating it from TRIP_SEEDS
 * — plus the 8 fixed meal slots, for a site that has a menu — the first time
 * it's requested. Every field is editable afterward from the site's admin page.
 */
export async function getOrCreateTripPage(slug: string) {
  const existing = await prisma.tripPage.findUnique({ where: { slug } });
  if (existing) return existing;

  const seed = TRIP_SEEDS[slug];
  if (!seed) throw new Error(`No trip page is set up for “${slug}”.`);

  return prisma.tripPage.create({
    data: {
      slug,
      ...seed,
      ...(tripSiteBySlug(slug)?.sections.menu ? { meals: { create: MEAL_SLOTS } } : {}),
    },
  });
}

/**
 * What an admin trip form gets back: nothing when it saved, `error` when it
 * was turned down (TripAdminForm shows it). `stale` marks a refusal about
 * something that changed after the page loaded rather than about what was
 * typed: the form then shows the refreshed page as it now stands instead of
 * putting the admin's entries back.
 */
export type TripFormResult = { error?: string; stale?: boolean };

/**
 * A problem with what was entered, or (`stale`) a change someone else made
 * first — the expected kinds of failure, shown on the form. Thrown rather
 * than returned so that, thrown inside a transaction, it also rolls back
 * everything that transaction wrote. Anything else is a real fault and still
 * throws to the error page.
 */
export class TripInputError extends Error {
  readonly stale: boolean;

  constructor(message: string, options: { stale?: boolean } = {}) {
    super(message);
    this.stale = options.stale ?? false;
  }
}

/**
 * Runs an admin trip action, turning a TripInputError into { error } for the
 * form. A refusal is often about something that changed after the page
 * loaded (the price was posted, a registration was removed), so the admin
 * pages are refreshed with it: the message arrives next to the current state.
 */
export async function tripFormResult(work: () => Promise<void>): Promise<TripFormResult> {
  try {
    await work();
    return {};
  } catch (error) {
    if (!(error instanceof TripInputError)) throw error;
    revalidateTripAdminPages();
    return error.stale ? { error: error.message, stale: true } : { error: error.message };
  }
}

/** The refusal for a trip page that was removed while its admin page was open. */
export const TRIP_PAGE_GONE = "This event's page no longer exists. Reload the page.";

/** Options for every transaction that locks a TripPage: short, and never queued for long behind another. */
export const TRIP_TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 10000 };

/**
 * Locks an event's TripPage row until the end of the transaction, then reads
 * it as it stands now. Null if there is no such row.
 *
 * This is how everything that depends on the event's terms takes turns: the
 * public registration form, an admin adding or editing a registration,
 * posting or changing the price, and settling registrations still waiting
 * for one. Each of them reads the price, the TBD flag, publication and the
 * deadline only *after* this lock, so a registration can never act on a "TBD"
 * it read before the price was posted, and posting the price sees every
 * registration that committed before it.
 *
 * Lock order, everywhere: this row first, then (public form only) the
 * per-email advisory lock, then registration rows. Never the other way round,
 * or two of these could each wait for the other.
 *
 * The row is locked by id and then re-read through Prisma: under Postgres's
 * READ COMMITTED each statement sees everything committed before it started,
 * so the read after the lock is current, and nobody else can change the row
 * until this transaction ends.
 */
export async function lockTripPage(tx: Prisma.TransactionClient, id: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "TripPage" WHERE "id" = ${id} FOR UPDATE`;
  if (locked.length === 0) return null;
  return tx.tripPage.findUniqueOrThrow({ where: { id } });
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

/**
 * TripActivity.time is free text an admin types ("4:00 PM", "9am", "17:30",
 * "9:00 AM - 11:00 AM", "Noon"), so turn it into minutes since midnight to
 * sort a day's activities morning → evening. A range sorts by its start time.
 * Returns null when there's nothing time-like to read ("TBD", "After dinner"),
 * and an hour with no AM/PM is read literally (so "7:00" is 7am, not dinner).
 */
export function activityTimeMinutes(time: string | null): number | null {
  if (!time) return null;
  const text = time.toLowerCase();

  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (!match) {
    if (text.includes("midnight")) return 0;
    if (text.includes("noon")) return 12 * 60;
    return null;
  }

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return null;

  const meridiem = match[3]?.[0];
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;

  return hour * 60 + minute;
}

/** All schedule entries for the trip, sorted chronologically (day, then time of day, then sortOrder, then creation order) rather than trusting DB-level enum ordering. Entries with no readable time sort after that day's timed ones. */
export async function getTripActivities(tripPageId: string) {
  const activities = await prisma.tripActivity.findMany({ where: { tripPageId } });
  return activities.sort((a, b) => {
    const dayDiff = TRIP_DAY_ORDER.indexOf(a.day) - TRIP_DAY_ORDER.indexOf(b.day);
    if (dayDiff !== 0) return dayDiff;
    const aMinutes = activityTimeMinutes(a.time) ?? Number.MAX_SAFE_INTEGER;
    const bMinutes = activityTimeMinutes(b.time) ?? Number.MAX_SAFE_INTEGER;
    if (aMinutes !== bMinutes) return aMinutes - bMinutes;
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
    // null, not owed − paid, while the price is unreleased: amountOwedCents is
    // a $0 placeholder then, and "remaining" has to read as not-set (the same
    // null paymentStatus() already treats as "Fee Not Set"), never as paid.
    return { ...reg, paidCents, remainingCents: reg.owedPending ? null : reg.amountOwedCents - paidCents };
  });
}

type RegistrationBalance = { owedPending: boolean; remainingCents: number | null; paidCents: number };

/** Settled in full — never true for a registration still awaiting the price. */
export function isPaidInFull(reg: Pick<RegistrationBalance, "remainingCents">) {
  return reg.remainingCents !== null && reg.remainingCents <= 0;
}

/** The registration's status badge; "Price TBD" while its amount owed isn't set yet. */
export function tripPaymentStatus(reg: RegistrationBalance) {
  return reg.owedPending ? { label: "Price TBD", cls: "badge-pending" } : paymentStatus(reg.remainingCents, reg.paidCents);
}

/** paymentRowClass() for a trip registration: uncolored while the price is TBD. */
export function tripPaymentRowClass(reg: RegistrationBalance) {
  return reg.owedPending ? undefined : paymentRowClass(reg.remainingCents, reg.paidCents);
}

/** "$35.00 remaining" — or "amount owed TBD" while the price is unreleased. */
export function tripRemainingText(reg: RegistrationBalance) {
  return reg.remainingCents === null ? "amount owed TBD" : `${formatCents(reg.remainingCents)} remaining`;
}

/** "Owed $90.00 · Paid $90.00 · Remaining $0.00" — or "Owed TBD · Paid $90.00" while the price is unreleased. */
export function tripBalanceLine(reg: RegistrationBalance & { amountOwedCents: number }) {
  if (reg.remainingCents === null) return `Owed TBD (price not released yet) · Paid ${formatCents(reg.paidCents)}`;
  return `Owed ${formatCents(reg.amountOwedCents)} · Paid ${formatCents(reg.paidCents)} · Remaining ${formatCents(reg.remainingCents)}`;
}

/** The trip's expenses (and vendor credits/refunds) in the order they were spent, oldest first. */
export async function getTripExpenses(tripPageId: string) {
  return prisma.tripExpense.findMany({
    where: { tripPageId },
    include: { recordedByUser: { select: { username: true } } },
    orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Expense totals with vendor credits/refunds netted out: spentCents is what
 * went out, creditCents what came back, and netCents the difference — the
 * figure both "Available to Spend" lines subtract.
 */
export function tripExpenseTotals(expenses: { amountCents: number; isCredit: boolean }[]) {
  const spentCents = expenses.reduce((sum, e) => sum + (e.isCredit ? 0 : e.amountCents), 0);
  const creditCents = expenses.reduce((sum, e) => sum + (e.isCredit ? e.amountCents : 0), 0);
  return { spentCents, creditCents, netCents: spentCents - creditCents };
}

/**
 * True once the trip's published RSVP deadline has passed. Dates are stored
 * as @db.Date, so the deadline means "through the end of that day, Eastern" —
 * the same treatment currentTripPriceCents gives the early-bird deadline
 * below. Used by both the public page (to stop showing the form) and
 * registerForTripAction (to stop accepting submissions), so the two can
 * never disagree about whether registration is open.
 */
export function registrationClosed(trip: { rsvpDeadline: Date | null }, now: Date = new Date()): boolean {
  if (!trip.rsvpDeadline) return false;
  return dateOnlyHasPassed(trip.rsvpDeadline, now);
}

/**
 * Whichever price tier is active right now — early-bird through midnight
 * Eastern at the end of its deadline day, regular price otherwise. Only used
 * to show the "current price" and to freeze a new registration's
 * amountOwedCents; existing registrations keep whatever amount they were
 * charged at signup.
 */
export function currentTripPriceCents(
  trip: { regularPriceCents: number; earlyBirdPriceCents: number | null; earlyBirdDeadline: Date | null },
  now: Date = new Date(),
): number {
  if (trip.earlyBirdPriceCents != null && trip.earlyBirdDeadline && !dateOnlyHasPassed(trip.earlyBirdDeadline, now)) {
    return trip.earlyBirdPriceCents;
  }
  return trip.regularPriceCents;
}
