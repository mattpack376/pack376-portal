"use client";

import { useFormStatus } from "react-dom";

/**
 * A form's submit button that asks before it submits — for the Delete/Remove
 * buttons, so one stray tap can't delete anything. Drop it into an existing
 * <form action={...}> in place of its <button type="submit">: cancelling the
 * confirm stops the submit, so the Server Action and its hidden inputs stay
 * exactly as they were. `message` should name what goes ("Delete the
 * announcement “Popcorn Sale”? …"), same as the other delete prompts.
 */
export default function ConfirmSubmitButton({
  message,
  className,
  pendingLabel,
  children,
}: {
  message: string;
  className?: string;
  /** Shown while the action runs, e.g. "Deleting…". */
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
