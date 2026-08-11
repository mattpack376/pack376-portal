const EXPIRING_SOON_DAYS = 30;

export function registrationStatus(registrationExpiresOn: Date | null, now: Date) {
  if (!registrationExpiresOn) return { label: "Not Set", cls: "badge-pending" };

  const daysLeft = Math.ceil((registrationExpiresOn.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { label: "Expired", cls: "badge-decline" };
  if (daysLeft <= EXPIRING_SOON_DAYS) return { label: "Expires Soon", cls: "badge-junior" };
  return { label: "Active", cls: "badge-attendance" };
}
