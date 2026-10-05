import "server-only";
import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";
import type { AuditDetail } from "@/lib/audit";
import { Role as RoleEnum } from "@/generated/prisma/enums";
import type { Role } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The tabs on /portal/admin/audit, split by what kind of entry it is. The log
 * records everything (every attendance mark, every sign-in), so a single list
 * buried the entries worth reading under the routine ones.
 *
 * A tab claims entries by `category` (the first segment of the action key)
 * or, where a category is only partly relevant, by exact `action`. "Main" is
 * whatever no other tab claims, so a newly added action always lands
 * somewhere visible without anyone remembering to update this list. "All
 * activity" is the old single list, kept so a person's or an address's
 * activity can still be read across every type at once.
 *
 * Security covers anything that grants, changes or removes access: login
 * accounts and their roles, passwords and dens ("user.*"), Parent Portal
 * logins created or revoked from the parent contacts page, and the Danger
 * Zone season reset. The rest of the parent-contact actions are ordinary
 * roster edits and stay in Main.
 */
type AuditTabDef = {
  label: string;
  description: string;
  categories?: readonly string[];
  actions?: readonly string[];
};

const CLAIMING_TABS = {
  signins: {
    label: "Sign-ins",
    description:
      "Every sign-in and failed sign-in attempt. Failed attempts for usernames that match no account show as “No account”.",
    categories: ["auth"],
  },
  security: {
    label: "Security",
    description:
      "Changes to who can get in and what they can do — logins created or deleted, access levels, den assignments, password resets, Parent Portal access, and the season reset.",
    categories: ["user", "reset"],
    actions: [
      "parent.createAccount",
      "parent.invitePortal",
      "parent.linkPortal",
      "parent.unlinkPortal",
      "parent.revokePortal",
    ],
  },
  attendance: {
    label: "Attendance",
    description: "Every attendance mark, den reset, meeting status and meeting label change.",
    categories: ["attendance"],
  },
  dues: {
    label: "Dues",
    description: "Dues payments recorded or deleted, per-scout dues amounts, and the dues settings.",
    categories: ["dues"],
  },
  conron: {
    label: "Camp Conron",
    description: "Everything on the Camp Conron trip — details, pricing, registrations, payments, expenses, duties and activities.",
    categories: ["trip", "tripPayment", "tripRegistration"],
  },
} as const satisfies Record<string, AuditTabDef>;

export const AUDIT_TABS = {
  main: {
    label: "Main",
    description:
      "Everything that isn’t a sign-in, security, attendance, dues or Camp Conron entry — advancement, scouts, events, calendar, announcements and the rest.",
  },
  ...CLAIMING_TABS,
  all: {
    label: "All activity",
    description: "Every entry from every tab in one list — useful with the Who filter, or after clicking an address.",
  },
} as const satisfies Record<string, AuditTabDef>;

export type AuditTab = keyof typeof AUDIT_TABS;

export function isAuditTab(value: string | undefined): value is AuditTab {
  return value !== undefined && Object.hasOwn(AUDIT_TABS, value);
}

function claimConditions(tab: AuditTabDef): Prisma.AuditLogWhereInput[] {
  const conditions: Prisma.AuditLogWhereInput[] = [];
  if (tab.categories?.length) conditions.push({ category: { in: [...tab.categories] } });
  if (tab.actions?.length) conditions.push({ action: { in: [...tab.actions] } });
  return conditions;
}

function tabWhere(tab: AuditTab): Prisma.AuditLogWhereInput {
  if (tab === "all") return {};
  if (tab === "main") {
    // category and action are both non-null, so NOT(OR(...)) can't drop rows
    // to SQL's NULL handling.
    return { NOT: { OR: Object.values(CLAIMING_TABS).flatMap(claimConditions) } };
  }
  return { OR: claimConditions(CLAIMING_TABS[tab]) };
}

/**
 * The Role filter. These used to be the tabs themselves; they're a dropdown
 * now that the tabs split by type. "none" picks out entries with no account
 * behind them at all (actorRole is null only for a failed sign-in against a
 * username that doesn't exist).
 */
export const NO_ACCOUNT_ROLE = "none";
export type AuditRoleFilter = Role | typeof NO_ACCOUNT_ROLE;

export function parseAuditRoleFilter(value: string | undefined): AuditRoleFilter | undefined {
  if (value === NO_ACCOUNT_ROLE) return value;
  return value !== undefined && Object.hasOwn(RoleEnum, value) ? (value as Role) : undefined;
}

export const AUDIT_PAGE_SIZE = 50;

/**
 * Human labels for the `category` column, which recordAudit derives from the
 * first segment of each action key. A category with no entry here falls back
 * to the raw value, so adding a new action never leaves a blank filter option.
 */
export const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  adultLeader: "Leader & Committee List",
  advancement: "Advancement",
  album: "Photo Albums",
  auth: "Sign-ins",
  announcement: "Announcements",
  attendance: "Attendance",
  banner: "Homepage Banner",
  calendarEvent: "Calendar",
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
  receipt: "Receipts",
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
  tab: AuditTab;
  role?: AuditRoleFilter;
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
  const scopeWhere = tabWhere(filters.tab);
  const where: Prisma.AuditLogWhereInput = {
    ...scopeWhere,
    ...(filters.role ? { actorRole: filters.role === NO_ACCOUNT_ROLE ? null : filters.role } : {}),
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
   * Options come from the same tab as the table, so the Sign-ins tab doesn't
   * offer "Advancement" in the What dropdown. Grouped in the database rather
   * than derived from `entries`, which is only the current page.
   */
  const [actorGroups, categoryGroups, denGroups, roleGroups] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["actorUserId", "actorUsername", "actorDisplayName"],
      where: scopeWhere,
      _count: { _all: true },
    }),
    prisma.auditLog.groupBy({ by: ["category"], where: scopeWhere, _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ["denId"], where: { ...scopeWhere, denId: { not: null } } }),
    prisma.auditLog.groupBy({ by: ["actorRole"], where: scopeWhere, _count: { _all: true } }),
  ]);

  const actors = actorGroups
    .map((group) => ({
      // Entries whose account was deleted have a null actorUserId and can't be
      // filtered to individually; they're still in the unfiltered list.
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

  const roles = roleGroups
    .map((group) => ({ value: (group.actorRole ?? NO_ACCOUNT_ROLE) as AuditRoleFilter, count: group._count._all }))
    .sort((a, b) => b.count - a.count);

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
    roles,
  };
}
