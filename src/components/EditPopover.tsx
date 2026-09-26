"use client";

import { useRef } from "react";

/**
 * The .edit-popover "Edit" button and its form, closing itself once the save
 * finishes. The plain <details className="edit-popover"> markup used on other
 * admin pages stays open after saving, since nothing tells the <details> the
 * save happened. If the action throws, the box stays open and the error
 * surfaces as usual.
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
