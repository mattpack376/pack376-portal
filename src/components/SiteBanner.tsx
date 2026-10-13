import { getActiveSiteBanner } from "@/lib/siteBannerData";

/**
 * The pack-wide top banner, for the public pages: goes right under <Header />.
 * Renders nothing when no banner is live. A page that shows it needs
 * `export const revalidate = 300` — see the note in src/app/page.tsx.
 */
export default async function SiteBanner() {
  const siteBanner = await getActiveSiteBanner();
  if (!siteBanner) return null;
  return <div className="site-banner">{siteBanner.message}</div>;
}
