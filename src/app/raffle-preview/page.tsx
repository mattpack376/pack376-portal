import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import RafflePublicPreview from "@/components/RafflePublicPreview";

/*
 * An unlisted design preview of a public 50/50 raffle page, here so it can be
 * looked at on a real phone. On purpose it is:
 *
 *  - not linked from the menu, the footer, the portal or any other page;
 *  - left out of sitemap.ts, and marked noindex so search engines skip it
 *    (deliberately NOT added to robots.ts — a Disallow line would only
 *    advertise the address);
 *  - a mock. The board is a fixed sample and the request form saves and sends
 *    nothing (see RafflePublicPreview).
 *
 * When a real public page is built on the portal's raffle data, replace this
 * route rather than linking to it.
 */
export const metadata: Metadata = {
  title: "50/50 Raffle (Preview) — Pack 376",
  description: "A design preview of a public 50/50 raffle page. Not live.",
  robots: { index: false, follow: false },
};

export default async function RafflePreviewPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const { stage } = await searchParams;
  const drawn = stage === "drawn";

  return (
    <>
      <Header />

      <div className="rp-preview-bar" role="note">
        <span>
          <strong>Design preview.</strong> Nothing here is live, and requests aren&apos;t sent or saved.
        </span>
        <span className="rp-preview-switch">
          <Link href="/raffle-preview" aria-current={drawn ? undefined : "page"}>
            Selling now
          </Link>
          <Link href="/raffle-preview?stage=drawn" aria-current={drawn ? "page" : undefined}>
            After the drawing
          </Link>
        </span>
      </div>

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.14)", color: "var(--white)" }}>
          50/50 Raffle
        </div>
        <h1>Camp Conron 50/50 Raffle</h1>
        {drawn ? (
          <p>Drawn Saturday, October 10, 2026.</p>
        ) : (
          <>
            <p>
              Pick a box for $10. On drawing day one box is drawn. Whoever holds it wins half the pot, and the other
              half goes to the pack.
            </p>
            <p style={{ fontWeight: 700, color: "var(--white)", marginTop: 12 }}>Drawing: Saturday, October 10, 2026</p>
          </>
        )}
      </section>

      {/* Keyed so switching between the two previews starts each one fresh. */}
      <RafflePublicPreview key={drawn ? "drawn" : "selling"} drawn={drawn} />

      <Footer />
    </>
  );
}
