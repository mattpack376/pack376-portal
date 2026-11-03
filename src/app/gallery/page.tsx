import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Header from "@/components/Header";
import SiteBanner from "@/components/SiteBanner";
import Footer from "@/components/Footer";
import { prisma } from "@/lib/prisma";
import { formatLongDate } from "@/lib/dateOnly";

// For the top banner: it goes up and comes down on a schedule, which no admin
// edit fires, so the page has to check again by itself. Same reasoning as the
// homepage.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Photo Albums — Pack 376",
  description: "Photos from Pack 376 pack nights, campouts, and events.",
};

export default async function GalleryPage() {
  const albums = await prisma.photoAlbum.findMany({
    where: { isVisible: true },
    orderBy: { eventDate: "desc" },
    include: { _count: { select: { photos: true } } },
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const past = albums.filter((a) => a.eventDate < today);

  const renderAlbums = (list: typeof albums) => (
    <div className="album-card-grid">
      {list.map((album) => {
        const photoCount = album._count.photos;
        const cover = (
          <div className="album-tile-cover">
            <Image
              src={album.coverImageUrl || "/cub-scout-emblem.png"}
              alt={album.title}
              fill
              sizes="(max-width: 640px) 100vw, 320px"
              style={{ objectFit: album.coverImageUrl ? "cover" : "contain" }}
            />
          </div>
        );
        const body = (
          <div className="album-tile-body">
            <div className="album-tile-date">{formatLongDate(album.eventDate)}</div>
            <h3>{album.title}</h3>
            {album.description && <p>{album.description}</p>}
            {photoCount > 0 && (
              <span className="link">
                See {photoCount} photo{photoCount === 1 ? "" : "s"} →
              </span>
            )}
          </div>
        );
        // Only albums with event photos open to a page of their own.
        return photoCount > 0 ? (
          <Link className="album-tile album-tile-link" key={album.id} href={`/gallery/${album.id}`}>
            {cover}
            {body}
          </Link>
        ) : (
          <div className="album-tile" key={album.id}>
            {cover}
            {body}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <Header />
      <SiteBanner />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          Snapshots From the Midway
        </div>
        <h1>Photo Albums</h1>
        <p>
          A peek at our pack nights, campouts, and events. Ask a den leader if you&apos;d like to
          add photos to an album.
        </p>
      </section>
      <div className="wave-divider" style={{ marginTop: -1 }}>
        <svg viewBox="0 0 1200 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0,40 C150,90 350,0 600,30 C850,60 1050,0 1200,40 L1200,70 L0,70 Z"
            fill="var(--cream)"
            style={{ transform: "scaleY(-1)", transformOrigin: "center" }}
          />
        </svg>
      </div>

      <section style={{ paddingTop: 24 }}>
        <div className="container">
          <div className="section-head center">
            <div className="eyebrow">Throwbacks</div>
            <h2>Past Events</h2>
          </div>
          {past.length === 0 ? (
            <p style={{ textAlign: "center" }}>No past albums yet.</p>
          ) : (
            renderAlbums(past)
          )}
        </div>
      </section>

      <Footer />
    </>
  );
}
