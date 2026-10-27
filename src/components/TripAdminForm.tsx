"use client";

import { Fragment, useActionState, useEffect, useRef } from "react";
import type { TripFormResult } from "@/lib/tripPageData";

type State = { error?: string; refusals: number };

/**
 * A form on an event's admin page whose action can turn the save down —
 * a $0 price being posted, a price that changed since the page loaded, too
 * many attendees — and says why above the fields instead of throwing to
 * production's generic error page. Same contract as ActionForm (the action
 * returns { error }, or nothing when it saved), plus two things these forms
 * need:
 *
 *  - The message is focused when it appears, so a keyboard or screen-reader
 *    user lands on it rather than on a button that looks like nothing happened.
 *  - After a refusal the fields inside are remounted. React resets an action
 *    form's fields to what was loaded after any submit anyway; remounting also
 *    gives a SaveButton inside a fresh start, so it doesn't pop its
 *    "Saved ✓" for a save that didn't happen, and it's greyed out again until
 *    something is changed.
 */
export default function TripAdminForm({
  action,
  children,
  className,
  style,
}: {
  action: (formData: FormData) => Promise<TripFormResult | void>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [state, formAction] = useActionState(
    async (previous: State, formData: FormData): Promise<State> => {
      const result = await action(formData);
      return result?.error ? { error: result.error, refusals: previous.refusals + 1 } : { refusals: previous.refusals };
    },
    { refusals: 0 },
  );
  const errorRef = useRef<HTMLDivElement>(null);

  // Moving focus is pushing state out to the DOM, which is what effects are
  // for. `state` is a new object for every result, so the same message
  // twice in a row is focused both times.
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className={className} style={style}>
      {state.error && (
        <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>
          {state.error}
        </div>
      )}
      <Fragment key={state.refusals}>{children}</Fragment>
    </form>
  );
}
