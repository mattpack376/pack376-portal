import { useActionState, useEffect, useRef } from "react";
import type { AlbumActionState } from "@/lib/actions/albums";
import { restoreFormEntries } from "@/lib/restoreFormEntries";

type AlbumAction = (previous: AlbumActionState, formData: FormData) => Promise<AlbumActionState>;

export type AlbumFormState = AlbumActionState & {
  /** What was submitted when the save was turned down, to put back into the form. */
  entries?: FormData;
};

/**
 * The step useActionState runs for an album form: the save itself, keeping
 * what was submitted when it's turned down. The server gets an empty
 * previous state rather than this one, so entries kept from an earlier
 * refusal — the photo among them — are never sent back up with the next try.
 * A save that worked ends in a redirect (thrown, and handled by Next.js), so
 * only refusals come back here.
 */
export function keepEntriesOnRefusal(action: AlbumAction) {
  return async (_previous: AlbumFormState, formData: FormData): Promise<AlbumFormState> => {
    const result = await action({}, formData);
    return result.error ? { error: result.error, entries: formData } : result;
  };
}

/**
 * useActionState for the New Album and Edit Album forms, putting what the
 * admin typed back after a refusal — a cover photo that's the wrong kind of
 * file or too large, a title that's too long. React clears an action form
 * after every submit, refusals included, so without this a refused cover
 * meant typing the title, date, description and album link again (New
 * Album), or losing the edits (Edit Album). The chosen photo can't be put
 * back and has to be picked again, which is usually what the message is about.
 * Same approach as TripAdminForm; see restoreFormEntries.
 */
export function useAlbumFormAction(action: AlbumAction) {
  const [state, formAction, pending] = useActionState(keepEntriesOnRefusal(action), {});
  const formRef = useRef<HTMLFormElement>(null);

  // After React's reset of the form, hence the timer: restoring any sooner
  // would be cleared again. `state` is a new object for every result, so the
  // same refusal twice in a row is handled both times.
  useEffect(() => {
    const entries = state.entries;
    if (!entries) return;
    const timer = setTimeout(() => {
      if (formRef.current) restoreFormEntries(formRef.current, entries);
    }, 0);
    return () => clearTimeout(timer);
  }, [state]);

  return { state, formAction, pending, formRef };
}
