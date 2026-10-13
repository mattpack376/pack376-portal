import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import RafflePublicPreview, { type RafflePublicBoard } from "@/components/RafflePublicPreview";
import { prisma } from "@/lib/prisma";
import { getRaffleDetail } from "@/lib/raffleData";
import { formatCents } from "@/lib/duesData";

/*
 * TABLED. The public raffle page is on hold at the pack's request (October
 * 12, 2026), so this address answers "page not found" for everyone — see
 * PREVIEW_ENABLED below. The page and RafflePublicPreview are kept, and keep
 * compiling, so the idea can be picked up where it was left: set the switch
 * to true to look at it again.
 *
 * What it is when switched on: an unlisted preview of a public 50/50 raffle
 * page, to be looked at on a real phone. It shows the real Camp Conron
 * raffle's board, read from the database on each visit. On purpose it is:
 *
 *  - not linked from the menu, the footer, the portal or any other page;
 *  - left out of sitemap.ts, and marked noindex so search engines skip it
 *    (deliberately NOT added to robots.ts — a Disallow line would only
 *    advertise the address);
 *  - read-only. Picking boxes and sending a request is a mock that changes
 *    nothing on the raffle (see RafflePublicPreview).
 *
 * Nobody is signed in here, so only what a stranger may see leaves this file:
 * box numbers and whether each is taken and paid for, the price, the winner's
 * share, the drawing date, the winning number and the prize. Buyer names and
 * payments stay on the server.
 *
 * When a real public page is built, replace this route rather than linking to it.
 */
export const metadata: Metadata = {
  title: "50/50 Raffle (Preview) — Pack 376",
  description: "A design preview of a public 50/50 raffle page. Not live.",
  robots: { index: false, follow: false },
};

/**
 * Off: the address is a 404 and nothing below runs. Typed as a plain boolean
 * so the rest of the file is still checked like live code.
 */
const PREVIEW_ENABLED: boolean = false;

/** The raffle the preview shows: the Camp Conron one, or failing that the newest. */
async function previewRaffle() {
  const found =
    (await prisma.raffle.findFirst({
      where: { name: { startsWith: "Camp Conron" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })) ?? (await prisma.raffle.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }));
  return found ? getRaffleDetail(found.id) : null;
}

export default async function RafflePreviewPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  if (!PREVIEW_ENABLED) notFound();

  const { stage } = await searchParams;
  const raffle = await previewRaffle();

  if (!raffle) {
    return (
      <>
        <Header />
        <section className="page-hero">
          <h1>50/50 Raffle</h1>
          <p>There is no raffle to preview yet.</p>
        </section>
        <Footer />
      </>
    );
  }

  const board: RafflePublicBoard = {
    boxCount: raffle.boxCount,
    priceCents: raffle.priceCents,
    prizePercent: raffle.prizePercent,
    drawing: raffle.drawingDate
      ? raffle.drawingDate.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : null,
    taken: raffle.entries.flatMap((entry) =>
      entry.boxNumbers.map((number) => ({ number, paid: entry.remainingCents <= 0 }))
    ),
    winningBox: raffle.winningBox,
    prizeCents: raffle.winningBox === null ? null : raffle.summary.prizeCents,
    prizePaid: raffle.prizePaid,
  };

  // The finished view only exists once a winner is recorded.
  const hasWinner = board.winningBox !== null;
  const drawn = hasWinner && stage === "drawn";
  const price = formatCents(raffle.priceCents).replace(/\.00$/, "");

  return (
    <>
      <Header />

      <div className="rp-preview-bar" role="note">
        <span>
          <strong>Design preview</strong> using the real board. Requests made here aren&apos;t sent or saved.
        </span>
        {hasWinner && (
          <span className="rp-preview-switch">
            <Link href="/raffle-preview" aria-current={drawn ? undefined : "page"}>
              Picking view
            </Link>
            <Link href="/raffle-preview?stage=drawn" aria-current={drawn ? "page" : undefined}>
              Finished view
            </Link>
          </span>
        )}
      </div>

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.14)", color: "var(--white)" }}>
          50/50 Raffle
        </div>
        <h1>{raffle.name}</h1>
        {drawn ? (
          board.drawing && <p>Drawn {board.drawing}.</p>
        ) : (
          <>
            <p>Pick a box for {price}. One box is drawn on drawing day, and whoever holds it wins the prize.</p>
            {board.drawing && (
              <p style={{ fontWeight: 700, color: "var(--white)", marginTop: 12 }}>Drawing: {board.drawing}</p>
            )}
          </>
        )}
      </section>

      {/* Keyed so switching between the two views starts each one fresh. */}
      <RafflePublicPreview key={drawn ? "drawn" : "picking"} board={board} drawn={drawn} />

      <Footer />
    </>
  );
}
