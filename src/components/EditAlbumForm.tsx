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
    googlePhotosUrl: string;
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
          <label htmlFor="coverImageUrl">Cover Image URL (optional)</label>
          <input id="coverImageUrl" name="coverImageUrl" type="url" defaultValue={album.coverImageUrl ?? ""} />
        </div>
        <div className="form-field">
          <label htmlFor="googlePhotosUrl">Google Photos Album Link</label>
          <input id="googlePhotosUrl" name="googlePhotosUrl" type="url" defaultValue={album.googlePhotosUrl} required />
        </div>
        {state?.error && <p className="form-error">{state.error}</p>}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
