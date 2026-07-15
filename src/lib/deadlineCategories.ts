import type { DeadlineCategory } from "@/generated/prisma/enums";

export const DEADLINE_CATEGORY_LABELS: Record<DeadlineCategory, string> = {
  CAMPING: "Camping Trip",
  DAY_TRIP: "Day Trip",
  SPECIAL_EVENT: "Special Event",
  GENERAL: "General",
};

export const DEADLINE_CATEGORY_ICONS: Record<DeadlineCategory, string> = {
  CAMPING: "⛺",
  DAY_TRIP: "🚌",
  SPECIAL_EVENT: "🎉",
  GENERAL: "📌",
};

export function formatDueDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
