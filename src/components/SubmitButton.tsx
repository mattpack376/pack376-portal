"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that can't be tapped twice while its form's action runs.
 * For forms that add something or that can be turned down (see ActionForm);
 * an edit form whose action always saves uses SaveButton instead.
 */
export default function SubmitButton({
  className,
  pendingLabel,
  children,
}: {
  className?: string;
  /** Shown while the action runs, e.g. "Saving…". */
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
