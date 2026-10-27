"use client";

import { Fragment, useActionState, useEffect, useRef } from "react";
import type { TripFormResult } from "@/lib/tripPageData";
import { restoreFormEntries } from "@/lib/restoreFormEntries";

type State = {
  error?: string;
  refusals: number;
  /** What was submitted, kept for a refusal about the entries themselves (not a stale one) so they can be put back. */
  entries?: FormData;
};

/**
 * A form on an event's admin page whose action can turn the save down —
 * a $0 price being posted, a price that changed since the page loaded, too
 * many attendees — and says why above the fields instead of throwing to
 * production's generic error page. Same contract as ActionForm (the action
 * returns { error }, or nothing when it saved), plus three things these
 * forms need:
 *
 *  - The message is focused when it appears, so a keyboard or screen-reader
 *    user lands on it rather than on a button that looks like nothing happened.
 *  - After a refusal the fields inside are remounted. React resets an action
 *    form's fields to what was loaded after any submit anyway; remounting also
 *    gives a SaveButton inside a fresh start, so it doesn't pop its
 *    "Saved ✓" for a save that didn't happen.
 *  - Then, unless the refusal says the page was out of date (`stale` — the
 *    price was posted, the registration was removed), what the admin entered
 *    is put back (restoreFormEntries) so only the field the message is about
 *    needs fixing, and a SaveButton sees the form still differs from what's
 *    saved. After a stale refusal the fields show the refreshed page instead.
 *    A successful save is left to React's reset: an add form comes back empty.
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
      if (!result?.error) return { refusals: previous.refusals };
      return { error: result.error, refusals: previous.refusals + 1, entries: result.stale ? undefined : formData };
    },
    { refusals: 0 },
  );
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Restoring entries and moving focus are both pushing state out to the
  // DOM, which is what effects are for. They have to come after React's form
  // reset and after every effect of the remounted fields — a SaveButton's
  // snapshot of the saved values among them, which in development React runs
  // a second time after this effect (Strict Mode), and would then take the
  // restored entries for what's saved and grey itself out. Hence a timer
  // rather than doing it in the effect itself. `state` is a new object for
  // every result, so the same message twice in a row is handled both times.
  useEffect(() => {
    if (!state.error) return;
    const entries = state.entries;
    const timer = setTimeout(() => {
      if (entries && formRef.current) restoreFormEntries(formRef.current, entries);
      errorRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={className} style={style}>
      {state.error && (
        <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>
          {state.error}
        </div>
      )}
      <Fragment key={state.refusals}>{children}</Fragment>
    </form>
  );
}
