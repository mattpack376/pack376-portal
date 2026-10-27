/*
 * Fixtures and action wrappers shared by the trip tests (tripPricing,
 * tripRegistration). Not a test file itself. App modules are imported lazily
 * — after a file's `db.ready` — because the app's Prisma client reads
 * DATABASE_URL when src/lib/prisma.ts is first imported.
 */
import assert from "node:assert/strict";
import type pg from "pg";
import type { PrismaClient } from "@/generated/prisma/client";
import { asAnonymous, form, runAs, type SessionUser } from "../support/context";

export type TripActions = {
  registration: typeof import("@/lib/actions/tripRegistration");
  page: typeof import("@/lib/actions/tripPage");
};

export async function loadTripActions(): Promise<TripActions> {
  return {
    registration: await import("@/lib/actions/tripRegistration"),
    page: await import("@/lib/actions/tripPage"),
  };
}

let userCounter = 0;

export async function createUser(prisma: PrismaClient, role: SessionUser["role"] = "ADMIN"): Promise<SessionUser> {
  userCounter += 1;
  const user = await prisma.user.create({
    data: { username: `trip-${role.toLowerCase()}-${userCounter}`, passwordHash: "x", role, displayName: `Trip ${role}` },
  });
  return { id: user.id, role: user.role, sessionVersion: user.sessionVersion, displayName: user.displayName };
}

/**
 * A fresh TripPage for `slug` (cyclones has the TBD toggle, camp-conron
 * doesn't), replacing any earlier one along with its registrations. Defaults:
 * published, price TBD at $0, no free tier, no deadlines.
 */
export async function freshTrip(
  prisma: PrismaClient,
  overrides: Partial<{
    slug: string;
    published: boolean;
    priceTbd: boolean;
    regularPriceCents: number;
    earlyBirdPriceCents: number | null;
    earlyBirdDeadline: Date | null;
    rsvpDeadline: Date | null;
    freeAgeAndUnder: number | null;
    flyerUrl: string | null;
  }> = {},
) {
  const slug = overrides.slug ?? "cyclones";
  await prisma.tripPage.deleteMany({ where: { slug } });
  return prisma.tripPage.create({
    data: {
      slug,
      title: slug === "cyclones" ? "Test Cyclones Overnight" : "Test Camp Conron",
      published: true,
      priceTbd: slug === "cyclones",
      regularPriceCents: 0,
      ...overrides,
    },
  });
}

let familyCounter = 0;

/** The public registration form's fields, each call a different family and address unless overridden. */
export function familyForm(tripPageId: string, overrides: Record<string, string | number> = {}) {
  familyCounter += 1;
  return {
    tripPageId,
    familyName: `The Family ${familyCounter}`,
    contactEmail: `family${familyCounter}@example.test`,
    contactPhone: "2125550100",
    guestOfName: "Timmy Test (Wolf Den)",
    affiliation: "PACK",
    payingCount: 2,
    freeCount: 0,
    ...overrides,
  };
}

/** Submits the public form as an anonymous visitor; returns the action's state. */
export async function register(actions: TripActions, values: Record<string, string | number>) {
  const { result } = await asAnonymous(() => actions.registration.registerForTripAction({}, form(values)));
  return result;
}

/** Saves the Price Structure form as `admin`. `priceTbd: true` keeps (or puts) the price back to TBD. */
export async function savePricing(
  actions: TripActions,
  admin: SessionUser,
  tripPageId: string,
  values: { regularPrice: string; priceTbd?: boolean; earlyBirdPrice?: string; earlyBirdDeadline?: string; rsvpDeadline?: string; freeAgeAndUnder?: string },
) {
  return runAs(admin, () =>
    actions.page.updateTripPricingAction(
      form({
        id: tripPageId,
        regularPrice: values.regularPrice,
        earlyBirdPrice: values.earlyBirdPrice ?? "",
        earlyBirdDeadline: values.earlyBirdDeadline ?? "",
        rsvpDeadline: values.rsvpDeadline ?? "",
        freeAgeAndUnder: values.freeAgeAndUnder ?? "",
        priceTbd: values.priceTbd ? "true" : undefined,
      }),
    ),
  );
}

/** The admin "add a family by hand" form. */
export async function addByHand(actions: TripActions, admin: SessionUser, values: Record<string, string | number>) {
  return runAs(admin, () => actions.registration.addTripRegistrationAction(form(values)));
}

/** The admin edit form for one registration; `amountOwed: ""` is the blank amount a waiting registration shows. */
export async function editRegistration(
  actions: TripActions,
  admin: SessionUser,
  registration: {
    id: string;
    familyName: string;
    contactEmail: string;
    contactPhone: string | null;
    guestOfName: string;
    affiliation: string;
    payingCount: number;
    freeCount: number;
  },
  changes: Record<string, string | number>,
) {
  return runAs(admin, () =>
    actions.registration.updateTripRegistrationAction(
      form({
        id: registration.id,
        familyName: registration.familyName,
        contactEmail: registration.contactEmail,
        contactPhone: registration.contactPhone ?? "",
        guestOfName: registration.guestOfName,
        affiliation: registration.affiliation,
        payingCount: registration.payingCount,
        freeCount: registration.freeCount,
        amountOwed: "",
        ...changes,
      }),
    ),
  );
}

/**
 * Resolves once at least `count` other backends in this database are waiting
 * on a lock — e.g. 2 when a registration and a price posting are both queued
 * behind a lock the test holds. (waitForLockWait in tests/support/db.ts is
 * the count = 1 case.)
 */
export async function waitForWaiters(pool: pg.Pool, count: number, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    );
    if (rows[0].waiting >= count) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${count} backends to block on a lock (saw ${rows[0].waiting})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Every registration of a trip, oldest first. */
export async function registrationsOf(prisma: PrismaClient, tripPageId: string) {
  return prisma.tripRegistration.findMany({ where: { tripPageId }, orderBy: { createdAt: "asc" } });
}

/**
 * The invariant this whole area is about: on a trip whose price is posted, no
 * registration is still waiting at $0, and each one waiting at publication
 * (or created after it) is charged attendees × `pricePerPersonCents`.
 */
export async function assertAllCharged(prisma: PrismaClient, tripPageId: string, pricePerPersonCents: number) {
  const trip = await prisma.tripPage.findUniqueOrThrow({ where: { id: tripPageId } });
  assert.equal(trip.priceTbd, false, "the price is posted");
  for (const reg of await registrationsOf(prisma, tripPageId)) {
    assert.equal(reg.owedPending, false, `${reg.familyName} is not left waiting for a price`);
    assert.equal(
      reg.amountOwedCents,
      reg.payingCount * pricePerPersonCents,
      `${reg.familyName} owes ${reg.payingCount} × ${pricePerPersonCents}`,
    );
  }
}

/** Lock-holding helpers on an independent connection (see openTransaction in tests/support/db.ts). */
export const LOCK_TRIP = `SELECT "id" FROM "TripPage" WHERE "id" = $1 FOR UPDATE`;
export const LOCK_REGISTRATION = `SELECT "id" FROM "TripRegistration" WHERE "id" = $1 FOR UPDATE`;
/** The public form's per-address advisory lock, exactly as registerForTripAction takes it. */
export const LOCK_EMAIL = `SELECT pg_advisory_xact_lock(hashtext($1))`;
export const emailLockKey = (tripPageId: string, email: string) => `trip-registration:${tripPageId}:${email.toLowerCase()}`;
