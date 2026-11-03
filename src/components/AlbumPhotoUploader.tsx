"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadAlbumPhotoAction } from "@/lib/actions/albumPhotos";
import { UPLOAD_SHRINK_SIDE } from "@/lib/albumPhotoRules";

/**
 * Largest file sent as it is when the browser can't shrink it. The hosting
 * platform turns away requests over about 4.5MB before the server sees them,
 * which would only show up as a confusing connection error.
 */
const MAX_UNSHRUNK_BYTES = 4 * 1024 * 1024;

type FileStatus = { name: string; state: "waiting" | "uploading" | "done" | "error"; message?: string };

/**
 * Shrinks a photo in the browser before it's sent: phone photos are often
 * 4–10MB, more than the hosting platform accepts in one request. Drawing it
 * onto a canvas also turns it upright and leaves its metadata (GPS position
 * and the rest) behind; the server cleans it again either way. If the browser
 * can't open the file (an iPhone HEIC photo on a non-Apple browser, say), the
 * original goes up as it is when it's small enough, and the server explains
 * what to do; null when it's too big to send at all.
 */
async function shrinkForUpload(file: File): Promise<File | null> {
  const shrunk = await tryShrink(file);
  if (shrunk) return shrunk;
  return file.size <= MAX_UNSHRUNK_BYTES ? file : null;
}

async function tryShrink(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, UPLOAD_SHRINK_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    // A see-through PNG gets a white background rather than black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return null;
    const name = file.name.replace(/\.[^.]*$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  }
}

/**
 * The Add Photos box on the Edit Album page. Photos go up one at a time, each
 * with its own line saying how it went, so one refused file doesn't stop the
 * rest. `remaining` is how many more the album can take right now; the server
 * checks the limit again on every photo.
 */
export default function AlbumPhotoUploader({ albumId, remaining }: { albumId: string; remaining: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function upload() {
    const chosen = Array.from(inputRef.current?.files ?? []);
    if (chosen.length === 0) {
      setNote("Choose one or more photos first.");
      return;
    }
    const files = chosen.slice(0, Math.max(0, remaining));
    setNote(
      chosen.length > files.length
        ? `Only ${files.length} more photo${files.length === 1 ? "" : "s"} fit in this album, so the rest were left out.`
        : null,
    );
    if (files.length === 0) return;

    setBusy(true);
    const list: FileStatus[] = files.map((f) => ({ name: f.name, state: "waiting" }));
    setStatuses([...list]);
    const update = (index: number, status: Partial<FileStatus>) => {
      list[index] = { ...list[index], ...status };
      setStatuses([...list]);
    };

    for (const [index, original] of files.entries()) {
      update(index, { state: "uploading" });
      try {
        const photo = await shrinkForUpload(original);
        if (!photo) {
          update(index, {
            state: "error",
            message:
              "This photo couldn't be opened in your browser, and it's too big to send as it is. " +
              "Save or export it as a JPEG (most phones and computers can) and upload that instead.",
          });
          continue;
        }
        const formData = new FormData();
        formData.set("albumId", albumId);
        formData.set("photo", photo);
        const result = await uploadAlbumPhotoAction(formData);
        update(index, result.ok ? { state: "done" } : { state: "error", message: result.error });
      } catch {
        update(index, {
          state: "error",
          message: "The upload didn't go through — check your connection and try this photo again.",
        });
      }
    }

    if (inputRef.current) inputRef.current.value = "";
    setBusy(false);
    router.refresh();
  }

  const label = { waiting: "Waiting", uploading: "Uploading…", done: "Added ✓", error: "Not added" };

  return (
    <div className="album-photo-uploader">
      <label htmlFor="albumPhotos">Add Photos</label>
      <input
        ref={inputRef}
        id="albumPhotos"
        type="file"
        multiple
        // HEIC left out on purpose: then iPhones hand over a JPEG copy of each photo.
        accept="image/jpeg,image/png,image/webp"
        disabled={busy || remaining <= 0}
      />
      <p className="form-note">
        JPEG, PNG or WEBP. Each photo is shrunk, stamped with a small “© Pack 376 NYC” mark, and has its hidden
        details (like where it was taken) removed. Only post photos of scouts whose families gave photo consent.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={upload}
        disabled={busy || remaining <= 0}
      >
        {busy ? "Uploading…" : "Upload Photos"}
      </button>
      {note && <p className="form-note" role="status">{note}</p>}
      {statuses.length > 0 && (
        <ul className="album-upload-status" aria-live="polite">
          {statuses.map((s, i) => (
            <li key={i} className={`is-${s.state}`}>
              <span className="album-upload-name">{s.name}</span> — {label[s.state]}
              {s.message && <span className="album-upload-error">{s.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
