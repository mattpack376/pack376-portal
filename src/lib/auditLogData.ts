import "server-only";
import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";
import type { AuditDetail } from "@/lib/audit";
import type { Role } from "@/generated/prisma/enums";

/**
 * The tabs on /portal/admin/audit. "Admins" and "Den Leaders" are the two
 * the log was asked for, and "Committee" covers the other role that edits
 * advancement and attendance. "Everyone" exists so no entry is ever only
 * reachable by guessing a URL — Attendance Only, Photographer, Parent and
 * Trip Viewer accounts all record entries too, and they'd otherwise be
 * invisible.
 *
 * The role filters match on actorRole, which is null for a failed sign-in
 * against a username no account has. Those entries therefore appear only
 * under "Everyone" — correct, since they belong to no role, but it means
 * "Everyone" is the tab to watch for someone probing for accounts.
 */
export const AUDIT_VIEWS = {
  admins: { label: "Admins", roles: ["ADMIN", "JUNIOR_ADMIN"] as Role[] },
  dens: { label: "Den Leaders", roles: ["DEN"] as Role[] },
  committee: { label: "Committee", roles: ["COMMITTEE"] as Role[] },
  all: { label: "Everyone", roles: null },
} as const;

export type AuditView = keyof typeof AUDIT_VIEWS;

export function isAuditView(value: string | undefined): value is AuditView {
  return value !== undefined && Object.hasOwn(AUDIT_VIEWS, value);
}

export const AUDIT_PAGE_SIZE = 50;

/**
 * Human labels for the `category` column, which recordAudit derives from the
 * first segment of each action key. A category with no entry here falls back
 * to the raw value, so adding a new action never leaves a blank filter option.
 */
export const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  advancement: "Advancement",
  album: "Photo Albums",
  auth: "Sign-ins",
  announcement: "Announcements",
  attendance: "Attendance",
  banner: "Homepage Banner",
  deadline: "Deadlines",
  den: "Dens",
  dues: "Dues",
  event: "Events",
  eventPayment: "Event Payments",
  eventRegistration: "Event Registrations",
  guestGroup: "Guest Groups",
  guestGroupPayment: "Guest Group Payments",
  homepageEvent: "Homepage Events",
  household: "Households",
  parent: "Parent Contacts",
  photoConsent: "Photo Consent",
  reset: "Season Reset",
  scout: "Scouts",
  trip: "Camp Conron Trip",
  tripPayment: "Trip Payments",
  tripRegistration: "Trip Registrations",
  user: "Logins & Roles",
  volunteerNeed: "Volunteer Needs",
};

export function auditCategoryLabel(category: string) {
  return AUDIT_CATEGORY_LABELS[category] ?? category;
}

/**
 * Reads the `details` JSON back into AuditDetail[]. The column is untyped
 * JSON, and entries written by an older version of recordAudit outlive the
 * code that wrote them, so anything that doesn't have the expected shape is
 * dropped rather than rendered as "[object Object]".
 */
export function parseAuditDetails(value: unknown): AuditDetail[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is AuditDetail =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as AuditDetail).label === "string" &&
      typeof (entry as AuditDetail).from === "string" &&
      typeof (entry as AuditDetail).to === "string"
  );
}

export type AuditFilters = {
  view: AuditView;
  actorUserId?: string;
  category?: string;
  denId?: string;
  /** Exact client address — reached by clicking one in the table, not a dropdown. */
  ipAddress?: string;
  page: number;
};

/**
 * One page of entries plus the values the filter dropdowns need. The dropdown
 * options are built from the log itself (not from the User/Den tables) so they
 * only ever offer filters that would actually return something — including
 * actors whose login has since been deleted, which is exactly when you most
 * want to look them up.
 */
export async function getAuditLogPage(filters: AuditFilters) {
  const roles = AUDIT_VIEWS[filters.view].roles;
  const where = {
    ...(roles ? { actorRole: { in: roles } } : {}),
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.denId ? { denId: filters.denId } : {}),
    ...(filters.ipAddress ? { ipAddress: filters.ipAddress } : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
  ]);

  /*
   * Options come from the same role scope as the table, so switching to
   * "Den Leaders" doesn't leave admin-only names in the Who dropdown. Grouped
   * in the database rather than derived from `entries`, which is only the
   * current page.
   */
  const scopeWhere = roles ? { actorRole: { in: roles } } : {};
  const [actorGroups, categoryGroups, denGroups] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["actorUserId", "actorUsername", "actorDisplayName"],
      where: scopeWhere,
      _count: { _all: true },
    }),
    prisma.auditLog.groupBy({ by: ["category"], where: scopeWhere, _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ["denId"], where: { ...scopeWhere, denId: { not: null } } }),
  ]);

  const actors = actorGroups
    .map((group) => ({
      // Entries whose account was deleted have a null actorUserId and can't be
      // filtered to individually; they're still listed under "Everyone".
      id: group.actorUserId,
      username: group.actorUsername,
      displayName: group.actorDisplayName,
      count: group._count._all,
    }))
    .filter((actor): actor is { id: string; username: string; displayName: string; count: number } => actor.id !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const categories = categoryGroups
    .map((group) => ({ value: group.category, label: auditCategoryLabel(group.category), count: group._count._all }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const denIds = denGroups.map((group) => group.denId).filter((id): id is string => id !== null);
  const denRows =
    denIds.length > 0
      ? await prisma.den.findMany({
          where: { id: { in: denIds } },
          select: { id: true, rank: true, scoutingYear: true, label: true },
        })
      : [];
  const dens = denRows
    .map((den) => ({ id: den.id, name: denDisplayName(den.rank, den.scoutingYear, den.label) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    entries,
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    actors,
    categories,
    dens,
  };
}
