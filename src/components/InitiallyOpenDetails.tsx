"use client";

import { useState } from "react";

/**
 * A <details> whose server-chosen open state applies only on first load. A
 * plain `<details open={…}>` is re-applied on every revalidation, so a card
 * that starts open because it's empty would snap shut the moment its first
 * item is saved. Here the visitor's own open/closed choice then stays put.
 */
export default function InitiallyOpenDetails({
  initialOpen,
  className,
  children,
}: {
  initialOpen: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      {children}
    </details>
  );
}
