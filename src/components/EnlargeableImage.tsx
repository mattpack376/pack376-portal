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
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  enlargedWidth?: number;
  enlargedHeight?: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={`Enlarge: ${alt}`}
        style={{ padding: 0, border: "none", background: "none", cursor: "zoom-in", lineHeight: 0 }}
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          style={{ borderRadius: 8, border: "1px solid var(--cream-dark)", display: "block" }}
        />
      </button>
      <dialog ref={dialogRef} className="enlarge-dialog" onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}>
        <Image
          src={src}
          alt={alt}
          width={enlargedWidth}
          height={enlargedHeight}
          style={{ display: "block", width: "100%", height: "auto", borderRadius: 8 }}
        />
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="btn btn-outline btn-small"
          style={{ marginTop: 14, borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
        >
          Close
        </button>
      </dialog>
    </>
  );
}
