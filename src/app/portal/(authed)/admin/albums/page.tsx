import Link from "next/link";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { prisma } from "@/lib/prisma";
import { requireAlbumSession } from "@/lib/authorize";
import { formatLongDate } from "@/lib/dateOnly";
import { deleteAlbumAction } from "@/lib/actions/albums";
import AlbumVisibilityToggle from "@/components/AlbumVisibilityToggle";
import { MAX_PHOTOS_PER_ALBUM } from "@/lib/albumPhotoRules";

export default async function AdminAlbumsPage() {
  // Checked here as well as in the layout: a layout isn't re-run on every
  // navigation and doesn't stop this page rendering, so the page guards its own data.
  const session = await requireAlbumSession();
  const canDelete = session.role === "ADMIN";
  const albums = await prisma.photoAlbum.findMany({
    orderBy: { eventDate: "desc" },
    include: { _count: { select: { photos: true } } },
  });
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
        <td data-label="Date">{formatLongDate(album.eventDate)}</td>
        <td data-label="Photos">{album._count.photos}</td>
        <td className="actions">
          <AlbumVisibilityToggle albumId={album.id} isVisible={album.isVisible} />
          <Link
            className="btn btn-quiet btn-small"
            href={`/portal/admin/albums/${album.id}`}
          >
            Edit
          </Link>
          {canDelete && (
            <form action={deleteAlbumAction}>
              <input type="hidden" name="albumId" value={album.id} />
              <ConfirmSubmitButton
                className="btn btn-danger btn-small"
                pendingLabel="Deleting…"
                message={`Delete the photo album “${album.title}”? This can't be undone.`}
              >
                Delete
              </ConfirmSubmitButton>
            </form>
          )}
        </td>
      </tr>
    ));

  return (
    <>
      <div
        className="page-head"
      >
        <div>
          <div className="eyebrow">Admin</div>
          <h2>Photo Albums</h2>
          <p>One album per event, with a cover photo and up to {MAX_PHOTOS_PER_ALBUM} event photos. Use Edit to add or remove photos.</p>
          <p className="form-note">
            Hide takes an album and its event photos off the public site (photos can take up to an hour to clear
            from caches). Its cover photo can still be opened by anyone who already has the cover&apos;s direct
            link. To take one event photo down for good, remove it on the album&apos;s Edit page; to take the whole
            album down, delete it (Admin only).
          </p>
        </div>
        <Link className="btn btn-primary" href="/portal/admin/albums/new">+ New Album</Link>
      </div>

      <div className="info-card" style={{ marginBottom: 24 }}>
        <h3>Upcoming Events</h3>
        {upcoming.length === 0 && <p>No upcoming albums yet.</p>}
        {upcoming.length > 0 && (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
                <th>Photos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{renderRows(upcoming)}</tbody>
          </table>
          </div>
        )}
      </div>

      <div className="info-card">
        <h3>Past Events</h3>
        {past.length === 0 && <p>No past albums yet.</p>}
        {past.length > 0 && (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
                <th>Photos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{renderRows(past)}</tbody>
          </table>
          </div>
        )}
      </div>
    </>
  );
}
