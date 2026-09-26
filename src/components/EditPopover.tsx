"use client";

import { useRef } from "react";

/**
 * The .edit-popover "Edit" button and its form, closing itself once the save
 * finishes — a bare <details> would stay open after saving, since nothing
 * tells it the save happened. If the action throws, the box stays open and
 * the error surfaces as usual. Every admin Edit popover goes through this.
 */
export default function EditPopover({
  action,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  async function saveAndClose(formData: FormData) {
    await action(formData);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details className="edit-popover" ref={detailsRef}>
      <summary className="btn btn-quiet btn-small" style={{ display: "inline-block", cursor: "pointer" }}>
        Edit
      </summary>
      <form action={saveAndClose}>{children}</form>
    </details>
  );
}
