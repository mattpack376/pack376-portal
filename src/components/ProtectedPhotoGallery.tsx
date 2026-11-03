"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { albumPhotoSrc } from "@/lib/albumPhotoRules";

type Photo = { id: string; width: number; height: number };

/**
 * The event photos on a public album page: a grid that opens into a
 * full-screen viewer.
 *
 * Nothing on a web page can stop a screenshot or a photo of the screen, so
 * this only makes casual saving harder:
 * - no right-click or long-press "Save image" menu, and no dragging a photo
 *   out (each picture sits under a see-through cover and ignores the pointer);
 * - Ctrl/Cmd+S doesn't save the page while it's open;
 * - the photos are left out when the page is printed;
 * - they load through /album-photos/… (never a storage link) and are only
 *   ever shown at screen size, watermarked.
 */
export default function ProtectedPhotoGallery({ title, photos }: { title: string; photos: Photo[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const isOpen = open !== null;
  // A swipe in progress: where the one finger started, or null when it isn't one.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The thumbnail that opened the viewer, to put focus back on when it closes.
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(null), []);
  const step = useCallback(
    (by: number) => setOpen((current) => (current === null ? null : (current + by + photos.length) % photos.length)),
    [photos.length],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        return;
      }
      if (open === null) return;
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "Tab") {
        // Keep Tab inside the viewer: the page behind it is covered up.
        const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        if (buttons.length === 0) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey
          ? index <= 0 ? buttons.length - 1 : index - 1
          : index === -1 || index === buttons.length - 1 ? 0 : index + 1;
        event.preventDefault();
        buttons[next].focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  // When the viewer opens (not on every photo change): no page scrolling behind
  // it, focus on its close button; when it closes, focus back on the thumbnail.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      openerRef.current?.focus();
    };
  }, [isOpen]);

  const blockMenu = (event: React.SyntheticEvent) => event.preventDefault();

  return (
    <div className="protected-photos" onContextMenu={blockMenu} onDragStart={blockMenu}>
      <ul className="protected-photo-grid">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              className="protected-photo-thumb"
              onClick={(event) => {
                openerRef.current = event.currentTarget;
                setOpen(index);
              }}
              aria-label={`Open photo ${index + 1} of ${photos.length}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route at a fixed size; next/image would add a second, savable address */}
              <img
                src={albumPhotoSrc(photo.id, "thumb")}
                alt={`Photo ${index + 1} from ${title}`}
                width={photo.width}
                height={photo.height}
                loading="lazy"
                draggable={false}
              />
              <span className="protected-photo-shield" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      {open !== null && (
        <div
          ref={dialogRef}
          className="photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${open + 1} of ${photos.length} from ${title}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onTouchStart={(event) => {
            // Only a one-finger swipe on an unzoomed page changes photo, so
            // pinching or panning a zoomed-in photo never does.
            const zoomed = (window.visualViewport?.scale ?? 1) > 1.01;
            const touch = event.touches[0];
            swipe.current = event.touches.length === 1 && !zoomed && touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchMove={(event) => {
            if (event.touches.length > 1) swipe.current = null;
          }}
          onTouchEnd={(event) => {
            const start = swipe.current;
            swipe.current = null;
            const end = event.changedTouches[0];
            if (!start || !end) return;
            const dx = end.clientX - start.x;
            const dy = end.clientY - start.y;
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            step(dx > 0 ? -1 : 1);
          }}
        >
          <div className="photo-lightbox-frame">
            {/* eslint-disable-next-line @next/next/no-img-element -- see the grid above */}
            <img
              key={photos[open].id}
              src={albumPhotoSrc(photos[open].id, "full")}
              alt={`Photo ${open + 1} from ${title}`}
              width={photos[open].width}
              height={photos[open].height}
              draggable={false}
            />
            <span className="protected-photo-shield" aria-hidden="true" />
          </div>
          <div className="photo-lightbox-count" aria-hidden="true">
            {open + 1} / {photos.length}
          </div>
          <button ref={closeRef} type="button" className="photo-lightbox-close" onClick={close} aria-label="Close">
            ×
          </button>
          {photos.length > 1 && (
            <>
              <button type="button" className="photo-lightbox-prev" onClick={() => step(-1)} aria-label="Previous photo">
                ‹
              </button>
              <button type="button" className="photo-lightbox-next" onClick={() => step(1)} aria-label="Next photo">
                ›
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
