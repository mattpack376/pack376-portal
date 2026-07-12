export function formatAuditTooltip(action: string, when: Date, username: string | null) {
  const formatted = when.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return username ? `${action} by ${username} — ${formatted}` : `${action} — ${formatted}`;
}
