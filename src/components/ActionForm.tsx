"use client";

import { useActionState } from "react";

export type ActionFormResult = { error?: string };

/**
 * A form for a Server Action that can turn down what was entered — a box
 * that's already taken, a winning number nobody bought — and says so above
 * the fields instead of throwing to the error page. The action returns
 * { error } for that, and nothing (or {}) when it saved.
 *
 * Use a plain submit button or SubmitButton inside, not SaveButton: its
 * "Saved ✓" would show after a refusal too.
 */
export default function ActionForm({
  action,
  children,
  className,
  style,
}: {
  action: (formData: FormData) => Promise<ActionFormResult | void>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [state, formAction] = useActionState(
    async (_previous: ActionFormResult, formData: FormData) => (await action(formData)) ?? {},
    {}
  );

  return (
    <form action={formAction} className={className} style={style}>
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      {children}
    </form>
  );
}
