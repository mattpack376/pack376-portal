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
        <p>Paste the share link from a Google Photos album — photos stay hosted there, this just lists it on the site.</p>
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
            <p className="form-note">Link to any photo online. If left blank, a default pack emblem is shown instead.</p>
          </div>
          <div className="form-field">
            <label htmlFor="googlePhotosUrl">Google Photos Album Link</label>
            <input id="googlePhotosUrl" name="googlePhotosUrl" type="url" placeholder="https://photos.app.goo.gl/…" required />
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
