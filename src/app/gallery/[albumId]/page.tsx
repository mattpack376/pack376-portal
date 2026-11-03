import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import SiteBanner from "@/components/SiteBanner";
import Footer from "@/components/Footer";
import ProtectedPhotoGallery from "@/components/ProtectedPhotoGallery";
import { prisma } from "@/lib/prisma";
import { formatLongDate } from "@/lib/dateOnly";

// Same as the gallery: the top banner changes on a schedule no edit fires.
export const revalidate = 300;

type Props = { params: Promise<{ albumId: string }> };

async function loadAlbum(albumId: string) {
  const album = await prisma.photoAlbum.findUnique({
    where: { id: albumId },
    select: {
      title: true,
      eventDate: true,
      description: true,
      isVisible: true,
      photos: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, width: true, height: true },
      },
    },
  });
  // A hidden album has no public page at all.
  return album && album.isVisible ? album : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const album = await loadAlbum((await params).albumId);
  if (!album) return { title: "Photo Albums — Pack 376" };
  return {
    title: `${album.title} — Photo Albums — Pack 376`,
    description: album.description ?? `Photos from ${album.title}, a Pack 376 event.`,
  };
}

export default async function AlbumPage({ params }: Props) {
  const album = await loadAlbum((await params).albumId);
  if (!album) notFound();

  return (
    <>
      <Header />
      <SiteBanner />

      <section className="page-hero album-page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          {formatLongDate(album.eventDate)}
        </div>
        <h1>{album.title}</h1>
        {album.description && <p>{album.description}</p>}
      </section>

      <section style={{ paddingTop: 32 }}>
        <div className="container">
          <p className="album-back-link">
            <Link className="link" href="/gallery">
              ← All Photo Albums
            </Link>
          </p>
          {album.photos.length === 0 ? (
            <p style={{ textAlign: "center" }}>Photos from this event are coming soon.</p>
          ) : (
            <ProtectedPhotoGallery title={album.title} photos={album.photos} />
          )}
        </div>
      </section>

      <Footer />
    </>
  );
}
