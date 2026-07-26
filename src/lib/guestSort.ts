import "server-only";

export type GuestSortKey = "family" | "guestof";

/** Sorts guest groups by family name or guest-of name (guest-of nulls sort last); unrecognized/missing sort keeps insertion order. */
export function sortGuestGroups<T extends { familyName: string; guestOfLabel: string | null }>(
  groups: T[],
  sortBy: string | undefined,
): T[] {
  if (sortBy === "guestof") {
    return [...groups].sort((a, b) => (a.guestOfLabel ?? "￿").localeCompare(b.guestOfLabel ?? "￿"));
  }
  if (sortBy === "family") {
    return [...groups].sort((a, b) => a.familyName.localeCompare(b.familyName));
  }
  return groups;
}
