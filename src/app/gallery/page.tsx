import type { Metadata } from "next";
import Image from "next/image";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Photo Albums — Pack 376",
  description: "Photos from Pack 376 pack nights, campouts, and events — past and upcoming.",
};

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function GalleryPage() {
  const albums = await prisma.photoAlbum.findMany({ where: { isVisible: true }, orderBy: { eventDate: "desc" } });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const upcoming = albums.filter((a) => a.eventDate >= today).reverse();
  const past = albums.filter((a) => a.eventDate < today);

  const renderAlbums = (list: typeof albums) => (
    <div className="album-card-grid">
      {list.map((album) => (
        <div className="album-tile" key={album.id}>
          <div className="album-tile-cover">
            <Image
              src={album.coverImageUrl || "/cub-scout-emblem.png"}
              alt={album.title}
              fill
              sizes="(max-width: 640px) 100vw, 320px"
              style={{ objectFit: album.coverImageUrl ? "cover" : "contain" }}
              unoptimized={!!album.coverImageUrl}
            />
          </div>
          <div className="album-tile-body">
            <div className="album-tile-date">{formatDate(album.eventDate)}</div>
            <h3>{album.title}</h3>
            {album.description && <p>{album.description}</p>}
            <a className="link" href={album.photoAlbumUrl} target="_blank" rel="noopener noreferrer">
              View Photos →
            </a>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <Header />

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          Snapshots From the Midway
        </div>
        <h1>Photo Albums</h1>
        <p>
          Photos live in our private, pack-only photo library — click into an album to browse and
          download. Ask a den leader if you&apos;d like to add photos to an album.
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
            <div className="eyebrow">Save the Date</div>
            <h2>Upcoming Events</h2>
          </div>
          {upcoming.length === 0 ? (
            <p style={{ textAlign: "center" }}>No upcoming albums yet — check back soon.</p>
          ) : (
            renderAlbums(upcoming)
          )}
        </div>
      </section>

      <section style={{ background: "var(--white)" }}>
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
