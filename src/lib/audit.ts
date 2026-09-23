import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";
import type { Role } from "@/generated/prisma/enums";

/**
 * One field that changed, already formatted for display. `from` and `to` are
 * strings (not the raw values) because the entry is written once and read
 * unchanged for as long as it's kept: a cents integer or a Date read back a
 * year later shouldn't depend on today's formatting code to still make sense.
 */
export type AuditDetail = { label: string; from: string; to: string };

/** How long entries are kept before the sweep below drops them. */
export const AUDIT_RETENTION_MONTHS = 12;

export type AuditEntry = {
  /** Dot-namespaced machine key, e.g. "dues.payment.add". First segment becomes `category`. */
  action: string;
  /** One human sentence with names already resolved — see the summary style note below. */
  summary: string;
  entityType?: string;
  entityId?: string | null;
  /** Set when the change belongs to a single den, so den-leader entries read in context. */
  denId?: string | null;
  details?: AuditDetail[] | null;
};

/** Placeholder for "no value" in a before/after pair. */
export const EMPTY = "—";

/**
 * Writes one audit entry for a change the acting session just made.
 *
 * Call this *after* the write succeeds, so the log never claims a change that
 * was rolled back. It deliberately swallows its own errors: a portal action
 * that already succeeded must not fail — and must not be reported to the user
 * as failed — because logging it afterwards didn't work. A dropped entry is
 * logged to the server console instead, which is where it can be noticed
 * without costing a leader their attendance edit.
 *
 * The actor's username is read here rather than taken from the session, since
 * SessionPayload carries only userId/role/displayName. That's one indexed
 * lookup per mutation, which is cheap next to the mutation itself.
 */
export async function recordAudit(session: SessionPayload, entry: AuditEntry) {
  const actor = await prisma.user
    .findUnique({
      where: { id: session.userId },
      select: { username: true, displayName: true, role: true },
    })
    .catch(() => null);

  await recordAuditAs(
    {
      // Left null if the row is already gone (an account deleting itself):
      // the denormalized fields below still say who it was.
      userId: actor ? session.userId : null,
      username: actor?.username ?? "(deleted account)",
      displayName: actor?.displayName ?? session.displayName,
      // Prefer the stored role over the session's: a session issued before a
      // role change carries the old one until the user signs in again.
      role: actor?.role ?? session.role,
    },
    entry
  );
}

/**
 * Who an entry is attributed to. Separate from SessionPayload because the
 * events that matter most here happen when there is no session yet: a
 * successful sign-in creates one a moment later, and a failed sign-in never
 * does. `userId` is null when no account backs the entry, and `role` is null
 * only when there is no account at all (see AuditLog.actorRole).
 */
export type AuditActor = {
  userId: string | null;
  username: string;
  displayName: string;
  role: Role | null;
};

/**
 * The low-level writer. Use recordAudit() when a session is in hand; this is
 * for the sign-in path, which is precisely where one isn't.
 *
 * Same swallow-everything contract as recordAudit: a sign-in that already
 * succeeded must not be turned into a failure — and a sign-in that already
 * failed must not be reported as some other error — because logging it
 * afterwards didn't work.
 */
export async function recordAuditAs(actor: AuditActor, entry: AuditEntry) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId,
        actorUsername: actor.username,
        actorDisplayName: actor.displayName,
        actorRole: actor.role,
        action: entry.action,
        category: entry.action.split(".")[0],
        summary: entry.summary,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        denId: entry.denId ?? null,
        details: entry.details && entry.details.length > 0 ? entry.details : undefined,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record entry", entry.action, error);
  }

  // Separate from the try above so a failed sweep is never mistaken for a
  // dropped entry — the entry is already safely written by this point.
  await sweepExpiredAuditEntries();
}

/**
 * Stand-in actor for a failed sign-in against a username no account has.
 *
 * The attempted string is deliberately NOT stored. The overwhelmingly common
 * way to land here by accident is typing a password into the username box, so
 * recording it would file people's live passwords in a log next to their own
 * name — and a password is exactly the kind of unknown "username" that reaches
 * this branch. The security signal worth having (someone is guessing at
 * accounts, and how often) survives without it; see the sign-in handling in
 * src/app/portal/login/actions.ts.
 */
export const UNKNOWN_ACCOUNT_ACTOR: AuditActor = {
  userId: null,
  username: "(unknown username)",
  displayName: "Not a real account",
  role: null,
};

/** The oldest timestamp still inside the retention window. */
export function auditRetentionCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - AUDIT_RETENTION_MONTHS);
  return cutoff;
}

/*
 * Retention is enforced here, piggybacked on writes, rather than by a Vercel
 * Cron job: a cron would need vercel.json, its own authenticated route, and a
 * CRON_SECRET configured in the dashboard — three things that can be silently
 * missing, on a schedule nobody watches. This runs wherever the app already
 * runs, with no configuration at all.
 *
 * The trade-off is that a completely idle portal can hold entries slightly
 * past 12 months, since nothing triggers a sweep until the next change. That's
 * the harmless direction to err, and no entries are accumulating meanwhile.
 */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SWEEP_BATCH_SIZE = 500;

/**
 * Module-level, so each warm serverless instance sweeps at most once per
 * interval. Instances don't share this, so a few redundant sweeps happen
 * across a fleet — which costs almost nothing, because a sweep with nothing
 * to delete is one indexed range scan over AuditLog_createdAt_idx that
 * returns no rows.
 */
let lastSweepAt = 0;

/**
 * Deletes entries past the retention window, in one bounded batch so a long
 * backlog can't turn somebody's save into a multi-second wait. Whatever is
 * left over is picked up by the next sweep; at this pack's volume a single
 * batch is far more than one interval's worth of expiring entries.
 */
async function sweepExpiredAuditEntries() {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  // Set before awaiting, so concurrent requests on this instance don't all
  // start their own sweep while the first one is still running.
  lastSweepAt = now;

  try {
    const expired = await prisma.auditLog.findMany({
      where: { createdAt: { lt: auditRetentionCutoff() } },
      select: { id: true },
      take: SWEEP_BATCH_SIZE,
    });
    if (expired.length === 0) return;

    const { count } = await prisma.auditLog.deleteMany({
      where: { id: { in: expired.map((entry) => entry.id) } },
    });
    console.log(`[audit] removed ${count} entries older than ${AUDIT_RETENTION_MONTHS} months`);
  } catch (error) {
    // Retry on the next interval rather than the next write, so a database
    // problem can't turn every mutation into an extra failing query.
    console.error("[audit] retention sweep failed", error);
  }
}

/**
 * Builds the changed-field list from before/after pairs, dropping everything
 * that didn't actually change so an entry only shows what the edit touched.
 *
 * Pass display-ready values or raw ones — formatValue below handles dates,
 * booleans, numbers, and null. Keys are the labels shown in the viewer, so
 * write them the way the form does ("First name", not "firstName").
 *
 *   changedFields({ "First name": [before.firstName, firstName] })
 */
export function changedFields(pairs: Record<string, [unknown, unknown]>): AuditDetail[] {
  const details: AuditDetail[] = [];
  for (const [label, [before, after]] of Object.entries(pairs)) {
    const from = formatValue(before);
    const to = formatValue(after);
    if (from !== to) details.push({ label, from, to });
  }
  return details;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY;
  if (value instanceof Date) return auditDate(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value.trim() === "" ? EMPTY : value.trim();
  return String(value);
}

/** Cents -> "$75.00", for summaries and before/after pairs about money. */
export function auditMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return EMPTY;
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * A stable date label for audit text. Uses UTC because the portal stores
 * date-only values as UTC midnight (see src/lib/dateOnly.ts) — formatting
 * those in a local zone would shift them a day.
 */
export function auditDate(value: Date | null | undefined): string {
  if (!value) return EMPTY;
  return value.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
