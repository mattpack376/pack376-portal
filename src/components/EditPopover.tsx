"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The .edit-popover "Edit" button and its form, closing itself once the save
 * finishes — a bare <details> would stay open after saving, since nothing
 * tells it the save happened. If the action throws, the box stays open and
 * the error surfaces as usual. Every admin Edit popover goes through this.
 *
 * Only one is open at a time: opening another closes the rest, since each is
 * positioned off its own row and several open together pile up on top of each
 * other. An open box also closes on a click outside it or Escape — it covers
 * the Edit buttons of the rows beneath it, so without that the only way to
 * reach the next person is to find the open one's own Edit button again.
 */
export default function EditPopover({
  action,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  async function saveAndClose(formData: FormData) {
    await action(formData);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  function handleToggle() {
    const me = detailsRef.current;
    if (!me) return;
    setIsOpen(me.open);
    if (!me.open) return;
    document.querySelectorAll<HTMLDetailsElement>("details.edit-popover[open]").forEach((other) => {
      if (other !== me) other.open = false;
    });
  }

  // Listeners only while open, so the usual case (dozens of closed Edit
  // buttons on a page) costs nothing.
  useEffect(() => {
    if (!isOpen) return;
    const close = () => {
      if (detailsRef.current) detailsRef.current.open = false;
    };
    const onPointerDown = (e: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <details className="edit-popover" ref={detailsRef} onToggle={handleToggle}>
      <summary className="btn btn-quiet btn-small" style={{ display: "inline-block", cursor: "pointer" }}>
        Edit
      </summary>
      <form action={saveAndClose}>{children}</form>
    </details>
  );
}
