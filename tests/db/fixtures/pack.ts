/*
 * Small builders for the rows the event and advancement tests need: dens,
 * scouts, logins (with the session fields runAs() wants), events and
 * adventures. Every name gets a counter so tests in one file never collide.
 */
import type pg from "pg";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Rank, Role } from "@/generated/prisma/enums";
import type { SessionUser } from "../../support/context";

let counter = 0;
const next = () => ++counter;

/**
 * fx.event()'s default date, as the edit form sends it. Far in the future so it
 * always counts as upcoming (self-registration refuses past events). A test
 * that re-saves a fixture event through the form must send this date, or the
 * save records a date change.
 */
export const DEFAULT_EVENT_DATE = "2199-06-01";

export function packFixtures(prisma: PrismaClient) {
  async function den(rank: Rank = "TIGER") {
    return prisma.den.create({ data: { rank, scoutingYear: "2026-2027", label: `D${next()}` } });
  }

  async function scout(denId: string, data: { active?: boolean; firstName?: string } = {}) {
    const n = next();
    return prisma.scout.create({
      data: { denId, firstName: data.firstName ?? `Scout${n}`, lastName: `Family${n}`, active: data.active ?? true },
    });
  }

  /** A login, returned in the shape runAs() takes; parents are linked to `scoutIds` through Parent rows. */
  async function user(role: Role, opts: { scoutIds?: string[]; denIds?: string[]; displayName?: string } = {}) {
    const n = next();
    const created = await prisma.user.create({
      data: {
        username: `${role.toLowerCase()}-${n}`,
        passwordHash: "x",
        role,
        displayName: opts.displayName ?? `${role} ${n}`,
      },
    });
    for (const scoutId of opts.scoutIds ?? []) {
      await prisma.parent.create({ data: { scoutId, name: created.displayName, userId: created.id } });
    }
    for (const denId of opts.denIds ?? []) {
      await prisma.denAssignment.create({ data: { userId: created.id, denId } });
    }
    const session: SessionUser = {
      id: created.id,
      role,
      sessionVersion: created.sessionVersion,
      displayName: created.displayName,
      scoutIds: opts.scoutIds ?? [],
      denIds: opts.denIds ?? [],
    };
    return session;
  }

  /** An upcoming, visible event that takes adult guests at $10 and guest kids at $5 unless told otherwise. */
  async function event(
    data: {
      feeCents?: number | null;
      adultFeeCents?: number | null;
      guestChildFeeCents?: number | null;
      visible?: boolean;
      eventDate?: Date;
      title?: string;
      flyerUrl?: string | null;
    } = {},
  ) {
    return prisma.event.create({
      data: {
        title: data.title ?? `Event ${next()}`,
        eventDate: data.eventDate ?? new Date(`${DEFAULT_EVENT_DATE}T00:00:00.000Z`),
        feeCents: data.feeCents === undefined ? 2500 : data.feeCents,
        adultFeeCents: data.adultFeeCents === undefined ? 1000 : data.adultFeeCents,
        guestChildFeeCents: data.guestChildFeeCents === undefined ? 500 : data.guestChildFeeCents,
        visible: data.visible ?? true,
        flyerUrl: data.flyerUrl ?? null,
      },
    });
  }

  async function adventure(rank: Rank, name?: string) {
    const n = next();
    return prisma.adventure.create({
      data: { rank, name: name ?? `Adventure ${n}`, type: "REQUIRED", sortOrder: n },
    });
  }

  return { den, scout, user, event, adventure };
}

/** Resolves once at least `count` other backends in this database are waiting on a lock. */
export async function waitForLockWaiters(pool: pg.Pool, count: number, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    );
    if (rows[0].waiting >= count) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${count} concurrent action(s) to block on a lock (saw ${rows[0].waiting})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
