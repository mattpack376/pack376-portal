import { revalidatePath } from "next/cache";
import { TRIP_SITES } from "@/lib/tripSites";

/**
 * The trip actions take a row id, not a site, so they refresh every event's
 * pages rather than look the site up first — re-rendering a page nobody has
 * open costs nothing, and an action can never leave the page it ran from stale.
 */
export function revalidateTripAdminPages() {
  for (const site of TRIP_SITES) revalidatePath(site.adminPath);
}

/** The admin pages plus the public pages families see. */
export function revalidateTripPages() {
  revalidateTripAdminPages();
  for (const site of TRIP_SITES) revalidatePath(site.publicPath);
}
