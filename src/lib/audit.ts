import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";

/**
 * One field that changed, already formatted for display. `from` and `to` are
 * strings (not the raw values) because the entry is written once and read
 * forever: a cents integer or a Date read back years later shouldn't depend
 * on today's formatting code to still make sense.
 */
export type AuditDetail = { label: string; from: string; to: string };

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
  try {
    const actor = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { username: true, displayName: true, role: true },
    });

    await prisma.auditLog.create({
      data: {
        // Left null if the row is already gone (an account deleting itself):
        // the denormalized fields below still say who it was.
        actorUserId: actor ? session.userId : null,
        actorUsername: actor?.username ?? "(deleted account)",
        actorDisplayName: actor?.displayName ?? session.displayName,
        // Prefer the stored role over the session's: a session issued before a
        // role change carries the old one until the user signs in again.
        actorRole: actor?.role ?? session.role,
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
