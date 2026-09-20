"use client";

import { useRef } from "react";
import Image from "next/image";

export default function EnlargeableImage({
  src,
  alt,
  width,
  height,
  enlargedWidth = 320,
  enlargedHeight = 314,
  fit,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  enlargedWidth?: number;
  enlargedHeight?: number;
  /** Optional object-fit for the thumbnail — use "contain" when the source aspect ratio may not match width/height (e.g. uploaded flyers/posters). Leaving unset preserves the default (unstretched) rendering used everywhere else. */
  fit?: "contain" | "cover";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={`Enlarge: ${alt}`}
        // maxWidth keeps the thumbnail (and the zoom badge pinned to its corner) inside a
        // narrow column instead of pushing its whole grid track past a phone's viewport.
        style={{ position: "relative", display: "inline-block", maxWidth: "100%", padding: 0, border: "none", background: "none", cursor: "zoom-in", lineHeight: 0 }}
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          // height:auto + aspectRatio let the box scale down proportionally once maxWidth
          // (100%, from globals.css) shrinks it, rather than staying at its full pixel height.
          style={{
            borderRadius: 8,
            border: "1px solid var(--cream-dark)",
            display: "block",
            height: "auto",
            ...(fit ? { objectFit: fit, width, aspectRatio: `${width} / ${height}` } : {}),
          }}
        />
        <span
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "var(--scout-blue)",
            color: "var(--white)",
            fontSize: 13,
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
          }}
        >
          🔍
        </span>
      </button>
      <dialog ref={dialogRef} className="enlarge-dialog" onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}>
        <Image
          src={src}
          alt={alt}
          width={enlargedWidth}
          height={enlargedHeight}
          style={{ display: "block", width: "100%", height: "auto", borderRadius: 8, ...(fit ? { objectFit: fit } : {}) }}
        />
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="btn btn-quiet btn-small"
          style={{ marginTop: 14 }}
        >
          Close
        </button>
      </dialog>
    </>
  );
}
