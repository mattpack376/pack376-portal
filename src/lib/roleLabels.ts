/** Every role assignable from the admin panel, including Den Leader — a Den
 * Leader's specific den(s) are assigned separately (see DenAssignment).
 * Order is the order the role pickers list them in. */
export const ASSIGNABLE_ROLES = [
  "ADMIN",
  "JUNIOR_ADMIN",
  "COMMITTEE",
  "DEN",
  "ATTENDANCE_ADMIN",
  "PHOTOGRAPHER",
  "TRIP_VIEWER",
] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * Roles that can be assigned to specific dens and show up as that den's
 * leader(s) on the dashboard, den page, and roster. For Admins and Junior
 * Admins this is only about being listed as the leader — they already reach
 * every den. For Den Leaders it is their whole scope. For Committee Members
 * it adds that den's Den Leader view (parent contacts, Family View, sending
 * photo consent links) on top of the pack-wide committee access.
 */
export const DEN_ASSIGNABLE_ROLES = ["ADMIN", "JUNIOR_ADMIN", "DEN", "COMMITTEE"] as const;

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  JUNIOR_ADMIN: "Junior Admin",
  COMMITTEE: "Committee Member",
  ATTENDANCE_ADMIN: "Attendance Only",
  PHOTOGRAPHER: "Photographer",
  DEN: "Den Leader",
  PARENT: "Parent",
  TRIP_VIEWER: "Trip Viewer",
};

/** One-line summary shown next to each option in the role pickers. */
export const ROLE_DESCRIPTIONS: Record<AssignableRole, string> = {
  ADMIN: "full access, except audit log, starting a fresh year, and creating or deleting admins",
  JUNIOR_ADMIN: "advancement & attendance for all dens, add scouts, view dues & event balances, post the top banner",
  COMMITTEE: "advancement & attendance for all dens, view photo consent & dues",
  DEN: "advancement & attendance for their assigned den(s), no money",
  ATTENDANCE_ADMIN: "attendance for all dens",
  PHOTOGRAPHER: "add/edit albums only (no delete)",
  TRIP_VIEWER: "view only, Camp Conron trip page only",
};

export const ROLE_BADGE_CLASSES: Record<string, string> = {
  ADMIN: "badge-admin",
  JUNIOR_ADMIN: "badge-junior",
  COMMITTEE: "badge-committee",
  ATTENDANCE_ADMIN: "badge-attendance",
  PHOTOGRAPHER: "badge-photographer",
  DEN: "badge-den",
  PARENT: "badge-parent",
  TRIP_VIEWER: "badge-viewer",
};
