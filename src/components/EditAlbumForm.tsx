"use client";

import { useActionState } from "react";
import { updateAlbumAction, type AlbumActionState } from "@/lib/actions/albums";

const initialState: AlbumActionState = {};

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function EditAlbumForm({
  album,
}: {
  album: {
    id: string;
    title: string;
    eventDate: Date;
    description: string | null;
    coverImageUrl: string | null;
    photoAlbumUrl: string;
  };
}) {
  const [state, formAction, pending] = useActionState(updateAlbumAction, initialState);

  return (
    <div className="info-card" style={{ maxWidth: 480 }}>
      <form action={formAction}>
        <input type="hidden" name="albumId" value={album.id} />
        <div className="form-field">
          <label htmlFor="title">Event Title</label>
          <input id="title" name="title" type="text" defaultValue={album.title} required />
        </div>
        <div className="form-field">
          <label htmlFor="eventDate">Event Date</label>
          <input id="eventDate" name="eventDate" type="date" defaultValue={toDateInputValue(album.eventDate)} required />
        </div>
        <div className="form-field">
          <label htmlFor="description">Description (optional)</label>
          <textarea id="description" name="description" rows={3} defaultValue={album.description ?? ""} />
        </div>
        <div className="form-field">
          <label htmlFor="coverImage">Cover Image (optional)</label>
          {album.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- small admin-only preview, not worth next/image ceremony
            <img
              src={album.coverImageUrl}
              alt="Current cover"
              style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 8, marginBottom: 8 }}
            />
          )}
          <input id="coverImage" name="coverImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
          <p className="form-note">
            Upload a photo from your device (JPEG, PNG, WEBP, or GIF, up to 8MB) — download it from our
            photo library first, don&apos;t paste a link. Leave blank to keep the current cover image.
          </p>
        </div>
        <div className="form-field">
          <label htmlFor="photoAlbumUrl">Photo Album Link</label>
          <input id="photoAlbumUrl" name="photoAlbumUrl" type="url" defaultValue={album.photoAlbumUrl} required />
        </div>
        {state?.error && <p className="form-error">{state.error}</p>}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
