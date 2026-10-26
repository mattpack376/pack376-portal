/**
 * The standalone event micro-sites that run on the TripPage model (a public,
 * no-login page families register on, plus its portal admin page). Everything
 * that differs from one event to the next lives here, so the page, admin view,
 * exports, proxy rules and nav are each written once and take a TripSite.
 *
 * Pure data — no "server-only", Prisma or next/cache — so the proxy and the
 * client-side PortalNav can import it. The seeded starting content for each
 * site's first row is in tripPageData.ts, which is server-only.
 */
export type TripSite = {
  /** TripPage.slug — one row per site. */
  slug: string;
  /** Portal admin page for the event. */
  adminPath: string;
  /** The public page's route inside this app; proxy.ts masks the subdomain onto it. */
  publicPath: string;
  /** Host headers that serve the public page at their root (production, then localhost). */
  publicHosts: string[];
  /** The live page's address, which the admin page links to (shown without the "https://"). */
  publicUrl: string;
  /** Portal nav link text and the admin page's heading. */
  navLabel: string;
  /** What the confirmation popup calls the event: "your family is registered for …". */
  registeredFor: string;
  /** "trip" or "event" — how the registration errors refer to it. */
  noun: string;
  /** Filename stem for the CSV/PDF exports. */
  fileStem: string;
  /** The line above the public page's title. */
  eyebrow: string;
  /** The notice bar under the public header, if the event has one. */
  publicBanner: string | null;
  /** What the public page shows while the TripPage is unpublished. */
  unpublished: { banner: string | null; heading: string; body: string };
  /** What attendees are called in headcounts: paying / free ones when the event has a free tier, anyone otherwise. */
  headcountNouns: { paying: [string, string]; free: [string, string]; anyone: [string, string] };
  /** Which of the weekend-only sections the event has. */
  sections: { menu: boolean; dutyRoster: boolean; schedule: boolean };
  /** Whether the admin page's set-up and family groups start open (an event still being run) or closed (one that's over and down to its expenses). */
  adminGroupsOpen: boolean;
};

export const CAMP_CONRON_SITE: TripSite = {
  slug: "camp-conron",
  adminPath: "/portal/admin/camp-conron",
  publicPath: "/camp-conron",
  publicHosts: ["conron.pack376nyc.org", "conron.localhost:3000"],
  publicUrl: "https://conron.pack376nyc.org",
  navLabel: "Camp Conron Trip",
  registeredFor: "Camp Conron",
  noun: "trip",
  fileStem: "camp-conron",
  eyebrow: "Pack 376 & Troop 376 Joint Trip",
  publicBanner:
    "📣 The menu and activity schedule are now posted. The duty roster is still being worked on as families continue to register, and the activity schedule is subject to change.",
  unpublished: {
    banner: "Thank you for making Conron 2026 a great success!",
    heading: "Thank You for Joining Us for Camp Conron 2026!",
    body: "We look forward to next year's Columbus Day Weekend Event at Camp Conron!",
  },
  headcountNouns: { paying: ["adult", "adults"], free: ["kid", "kids"], anyone: ["person", "people"] },
  sections: { menu: true, dutyRoster: true, schedule: true },
  adminGroupsOpen: false,
};

export const CYCLONES_SITE: TripSite = {
  slug: "cyclones",
  adminPath: "/portal/admin/cyclones",
  publicPath: "/cyclones",
  publicHosts: ["cyclones.pack376nyc.org", "cyclones.localhost:3000"],
  // The path on the main site, which works as-is. cyclones.pack376nyc.org also
  // resolves once that domain is added to the Vercel project (publicHosts above).
  publicUrl: "https://pack376nyc.org/cyclones",
  navLabel: "Cyclones Overnight",
  registeredFor: "the Brooklyn Cyclones Overnight",
  noun: "event",
  fileStem: "cyclones",
  eyebrow: "Pack 376 & Troop 376 Joint Event",
  publicBanner: null,
  unpublished: {
    banner: null,
    heading: "Brooklyn Cyclones Overnight",
    body: "Details and registration are coming soon. Check back here!",
  },
  headcountNouns: {
    paying: ["paying attendee", "paying attendees"],
    free: ["free attendee", "free attendees"],
    anyone: ["attendee", "attendees"],
  },
  sections: { menu: false, dutyRoster: false, schedule: false },
  adminGroupsOpen: true,
};

/** Newest first: the order they're listed in the nav. */
export const TRIP_SITES: TripSite[] = [CYCLONES_SITE, CAMP_CONRON_SITE];

export function tripSiteBySlug(slug: string): TripSite | undefined {
  return TRIP_SITES.find((site) => site.slug === slug);
}

/** The site a request's Host header belongs to, if any. */
export function tripSiteByHost(host: string): TripSite | undefined {
  return TRIP_SITES.find((site) => site.publicHosts.includes(host));
}

/**
 * "3 adults, 2 kids (4 & under)" — the paying/free split as a sentence. When an
 * event has no free age (`freeAgeAndUnder` null) it has no free tier either, so
 * a headcount of only paying attendees leaves the free half out. `and` picks
 * the word between the age and "under": the admin cards say "4 & under", the
 * unit summary "4 and under".
 */
export function describeHeadcount(
  site: TripSite,
  freeAgeAndUnder: number | null,
  paying: number,
  free: number,
  and: "&" | "and" = "&",
): string {
  const noun = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`;
  if (freeAgeAndUnder === null && free === 0) return noun(paying, site.headcountNouns.anyone);
  const age = freeAgeAndUnder === null ? "" : ` (${freeAgeAndUnder} ${and} under)`;
  return `${noun(paying, site.headcountNouns.paying)}, ${noun(free, site.headcountNouns.free)}${age}`;
}

/** describeHeadcount plus " — 5 total" — except where it would only repeat the one number (an event with no free tier). */
export function describeHeadcountWithTotal(site: TripSite, freeAgeAndUnder: number | null, paying: number, free: number): string {
  const text = describeHeadcount(site, freeAgeAndUnder, paying, free);
  return freeAgeAndUnder === null && free === 0 ? text : `${text} — ${paying + free} total`;
}
