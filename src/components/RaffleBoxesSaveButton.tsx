"use client";

import { useFormStatus } from "react-dom";

/**
 * The Save button on a buyer's Boxes form. Adding a box saves straight away;
 * taking one away asks first, naming the boxes, like every other delete in
 * the portal. It reads the ticked boxes off its own form at the moment it's
 * pressed, so the form's fields stay plain uncontrolled inputs.
 */
export default function RaffleBoxesSaveButton({ buyerName, className }: { buyerName: string; className?: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(event) => {
        const form = event.currentTarget.form;
        if (!form) return;
        const ticked = [...form.querySelectorAll<HTMLInputElement>('input[name="remove"]:checked')].map((input) => input.value);
        if (ticked.length === 0) return;
        const boxes = `${ticked.length === 1 ? "box" : "boxes"} ${ticked.join(", ")}`;
        const opens = ticked.length === 1 ? "It will be open again." : "They will be open again.";
        if (!window.confirm(`Take ${boxes} away from ${buyerName}? ${opens}`)) event.preventDefault();
      }}
    >
      {pending ? "Saving…" : "Save Boxes"}
    </button>
  );
}
