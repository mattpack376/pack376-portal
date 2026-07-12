/** Every role assignable from the admin panel, including Den Leader — a Den
 * Leader's specific den(s) are assigned separately (see DenAssignment). */
export const ASSIGNABLE_ROLES = ["ADMIN", "JUNIOR_ADMIN", "ATTENDANCE_ADMIN", "PHOTOGRAPHER", "DEN"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  JUNIOR_ADMIN: "Junior Admin",
  ATTENDANCE_ADMIN: "Attendance Only",
  PHOTOGRAPHER: "Photographer",
  DEN: "Den Leader",
};

export const ROLE_BADGE_CLASSES: Record<string, string> = {
  ADMIN: "badge-admin",
  JUNIOR_ADMIN: "badge-junior",
  ATTENDANCE_ADMIN: "badge-attendance",
  PHOTOGRAPHER: "badge-photographer",
  DEN: "badge-den",
};
