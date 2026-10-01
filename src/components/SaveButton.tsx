"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

/*
 * The Save button for an edit form. Drop it into an existing
 * <form action={...}> (or an EditPopover) in place of its
 * <button type="submit">; the Server Action is unchanged. It:
 *
 *  - stays greyed out until something in its form differs from what was
 *    loaded, so a stray tap (or Enter) on an untouched form saves nothing;
 *  - shows "Saving…" and can't be tapped again while the save runs;
 *  - pops a "Saved ✓" toast when it finishes. A toast rather than the button
 *    label, because the Edit popovers close on save and take the button out of
 *    sight. A failed save throws to the error page as before, so the toast
 *    only ever follows a save that went through;
 *  - while its form has unsaved edits, asks before the page is left — a link,
 *    a reload, or closing the tab.
 *
 * "Changed" is the form's values compared with a snapshot taken on load and
 * again after each save, so typing something and then changing it back
 * counts as no change.
 */

const LEAVE_PROMPT = "You have unsaved changes. Leave this page without saving them?";

/** Forms on this page with unsaved edits, across every SaveButton. */
const dirtyForms = new Set<HTMLFormElement>();
let leaveGuardInstalled = false;

function installLeaveGuard() {
  if (leaveGuardInstalled) return;
  leaveGuardInstalled = true;

  // Reload, closing the tab, typing a new address: the browser's own prompt.
  window.addEventListener("beforeunload", (event) => {
    if (dirtyForms.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // In-app links navigate client-side, which beforeunload never sees. Capture
  // phase, so this runs before <Link>'s own handler, which then sees the
  // cancelled click and stays put.
  document.addEventListener(
    "click",
    (event) => {
      if (dirtyForms.size === 0 || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // opens a new tab
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (link.hasAttribute("data-file-download")) return; // FileExportButton saves a file, stays on the page
      const to = new URL(link.href, window.location.href);
      if (to.origin === window.location.origin && to.pathname === window.location.pathname && to.search === window.location.search) return;
      if (window.confirm(LEAVE_PROMPT)) dirtyForms.clear(); // leaving anyway — don't ask twice
      else event.preventDefault();
    },
    true
  );
}

function snapshot(form: HTMLFormElement) {
  const parts: string[] = [];
  new FormData(form).forEach((value, key) => {
    parts.push(`${key}=${typeof value === "string" ? value : `${value.name}:${value.size}:${value.lastModified}`}`);
  });
  return parts.join("&");
}

export default function SaveButton({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const baseline = useRef<string | null>(null);
  const wasPending = useRef(false);
  const { pending } = useFormStatus();
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Watch the form for edits.
  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) return;
    installLeaveGuard();

    // Timers rather than requestAnimationFrame throughout: a hidden tab never
    // runs animation frames, so tapping Save and switching apps would leave
    // the button and the leave-guard stuck until you came back.
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A tick later, so client fields that compute a value from the one just
    // typed (a guest group's amount owed) have re-rendered first.
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const isDirty = baseline.current !== null && snapshot(form) !== baseline.current;
        setDirty(isDirty);
        if (isDirty) dirtyForms.add(form);
        else dirtyForms.delete(form);
      }, 0);
    };
    // Hydrated by now, and the fields before this button have run their own
    // effects, so this is what the page loaded with.
    baseline.current = snapshot(form);
    form.addEventListener("input", check);
    form.addEventListener("change", check);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", check);
      form.removeEventListener("change", check);
      dirtyForms.delete(form);
    };
  }, []);

  // A save just finished: the saved values are the new baseline, and say so.
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;

    // The commit that ends the save also resets the form and re-renders it
    // with what the server stored (a phone number reformatted, say), so the
    // form as it stands now is the new baseline.
    const form = buttonRef.current?.form;
    if (form) {
      baseline.current = snapshot(form);
      dirtyForms.delete(form);
    }
    setDirty(false);
    setSaved(true);
    const hide = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(hide);
  }, [pending]);

  return (
    <>
      <button
        ref={buttonRef}
        type="submit"
        className={className}
        style={style}
        disabled={pending || !dirty}
        title={!dirty && !pending ? "Nothing changed yet" : undefined}
      >
        {pending ? "Saving…" : children}
      </button>
      {saved &&
        createPortal(
          <div className="save-toast" role="status" aria-live="polite">
            Saved ✓
          </div>,
          document.body
        )}
    </>
  );
}
