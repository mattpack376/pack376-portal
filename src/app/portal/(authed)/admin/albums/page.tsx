import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { deleteAlbumAction } from "@/lib/actions/albums";
import AlbumVisibilityToggle from "@/components/AlbumVisibilityToggle";

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function AdminAlbumsPage() {
  const session = await getSession();
  const canDelete = session?.role === "ADMIN";
  const albums = await prisma.photoAlbum.findMany({ orderBy: { eventDate: "desc" } });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const upcoming = albums.filter((a) => a.eventDate >= today).reverse();
  const past = albums.filter((a) => a.eventDate < today);

  const renderRows = (list: typeof albums) =>
    list.map((album) => (
      <tr key={album.id} style={album.isVisible ? undefined : { opacity: 0.55 }}>
        <td>
          {album.title}
          {!album.isVisible && (
            <span className="badge-pill badge-den" style={{ marginLeft: 8 }}>
              Hidden
            </span>
          )}
        </td>
        <td>{formatDate(album.eventDate)}</td>
        <td className="actions">
          <AlbumVisibilityToggle albumId={album.id} isVisible={album.isVisible} />
          <Link
            className="btn btn-outline btn-small"
            style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
            href={`/portal/admin/albums/${album.id}`}
          >
            Edit
          </Link>
          {canDelete && (
            <form action={deleteAlbumAction}>
              <input type="hidden" name="albumId" value={album.id} />
              <button
                type="submit"
                className="btn btn-outline btn-small"
                style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
              >
                Delete
              </button>
            </form>
          )}
        </td>
      </tr>
    ));

  return (
    <>
      <div
        className="section-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}
      >
        <div>
          <div className="eyebrow">Admin</div>
          <h2>Photo Albums</h2>
          <p>Link out to a Google Photos album for each event — leaders keep the photos there, this just curates the list.</p>
        </div>
        <Link className="btn btn-primary" href="/portal/admin/albums/new">+ New Album</Link>
      </div>

      <div className="info-card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Upcoming Events</h3>
        {upcoming.length === 0 && <p>No upcoming albums yet.</p>}
        {upcoming.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{renderRows(upcoming)}</tbody>
          </table>
        )}
      </div>

      <div className="info-card">
        <h3 style={{ marginTop: 0 }}>Past Events</h3>
        {past.length === 0 && <p>No past albums yet.</p>}
        {past.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{renderRows(past)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
