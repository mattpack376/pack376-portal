"use client";

import { useActionState } from "react";
import { createAlbumAction, type AlbumActionState } from "@/lib/actions/albums";

const initialState: AlbumActionState = {};

export default function NewAlbumPage() {
  const [state, formAction, pending] = useActionState(createAlbumAction, initialState);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Add a Photo Album</h2>
        <p>Paste the shareable link to the album in our photo library — photos stay hosted there, this just lists it on the site.</p>
      </div>

      <div className="info-card" style={{ maxWidth: 480 }}>
        <form action={formAction}>
          <div className="form-field">
            <label htmlFor="title">Event Title</label>
            <input id="title" name="title" type="text" placeholder="Camp Conron Weekend" required />
          </div>
          <div className="form-field">
            <label htmlFor="eventDate">Event Date</label>
            <input id="eventDate" name="eventDate" type="date" required />
          </div>
          <div className="form-field">
            <label htmlFor="description">Description (optional)</label>
            <textarea id="description" name="description" rows={3} placeholder="A few sentences about the event." />
          </div>
          <div className="form-field">
            <label htmlFor="coverImageUrl">Cover Image URL (optional)</label>
            <input id="coverImageUrl" name="coverImageUrl" type="url" placeholder="https://…" />
            <p className="form-note">
              Must be a direct image link, not an album share/viewer page (those are HTML pages, not
              images, so they won&apos;t display). Open the shared album, right-click a photo, choose
              &quot;Open image in new tab,&quot; and paste that URL here. Leave blank to use the pack emblem.
            </p>
          </div>
          <div className="form-field">
            <label htmlFor="photoAlbumUrl">Photo Album Link</label>
            <input id="photoAlbumUrl" name="photoAlbumUrl" type="url" placeholder="https://photos.pack376nyc.org/s/…" required />
          </div>
          {state?.error && <p className="form-error">{state.error}</p>}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Add Album"}
          </button>
        </form>
      </div>
    </>
  );
}
