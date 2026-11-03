import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAlbumSession } from "@/lib/authorize";
import EditAlbumForm from "@/components/EditAlbumForm";
import AlbumPhotoUploader from "@/components/AlbumPhotoUploader";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { deleteAlbumPhotoAction, moveAlbumPhotoAction } from "@/lib/actions/albumPhotos";
import { MAX_PHOTOS_PER_ALBUM } from "@/lib/albumPhotoRules";

export default async function EditAlbumPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  // Checked here as well as in the layout: a layout isn't re-run on every
  // navigation and doesn't stop this page rendering, so the page guards its own data.
  await requireAlbumSession();
  const { albumId } = await params;
  const album = await prisma.photoAlbum.findUnique({
    where: { id: albumId },
    include: { photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!album) notFound();
  const { photos } = album;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Edit Photo Album</h2>
      </div>
      <EditAlbumForm album={album} />

      <div className="info-card album-photos-admin" style={{ marginTop: 24 }}>
        <h3>
          Event Photos ({photos.length} of {MAX_PHOTOS_PER_ALBUM})
        </h3>
        <p className="form-note">
          These show on the album&apos;s page on the public Photo Albums page, in this order.
          {!album.isVisible && " This album is hidden, so they aren't showing right now."}
        </p>

        {photos.length > 0 && (
          <ol className="album-photo-admin-grid">
            {photos.map((photo, index) => (
              <li key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small admin-only preview, not worth next/image ceremony */}
                <img src={photo.thumbUrl} alt={`Photo ${index + 1}`} loading="lazy" />
                <div className="album-photo-admin-actions">
                  <span className="album-photo-admin-number">#{index + 1}</span>
                  <form action={moveAlbumPhotoAction}>
                    <input type="hidden" name="photoId" value={photo.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      type="submit"
                      className="btn btn-quiet btn-small"
                      disabled={index === 0}
                      aria-label={`Move photo ${index + 1} earlier`}
                    >
                      ←
                    </button>
                  </form>
                  <form action={moveAlbumPhotoAction}>
                    <input type="hidden" name="photoId" value={photo.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      type="submit"
                      className="btn btn-quiet btn-small"
                      disabled={index === photos.length - 1}
                      aria-label={`Move photo ${index + 1} later`}
                    >
                      →
                    </button>
                  </form>
                  <form action={deleteAlbumPhotoAction}>
                    <input type="hidden" name="photoId" value={photo.id} />
                    <ConfirmSubmitButton
                      className="btn btn-danger btn-small"
                      pendingLabel="Removing…"
                      message={`Remove photo ${index + 1} from “${album.title}”? It's deleted from the site and can't be undone.`}
                    >
                      Remove
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        )}

        {photos.length < MAX_PHOTOS_PER_ALBUM ? (
          <AlbumPhotoUploader albumId={album.id} remaining={MAX_PHOTOS_PER_ALBUM - photos.length} />
        ) : (
          <p className="form-note">This album is full. Remove a photo to add a different one.</p>
        )}
      </div>
    </>
  );
}
