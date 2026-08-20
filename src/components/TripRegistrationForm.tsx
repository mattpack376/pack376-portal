"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { registerForTripAction } from "@/lib/actions/tripRegistration";

/**
 * Public registration form for a TripPage — no account required. Selecting
 * an affiliation reveals that org's payment instructions (admin-edited
 * content, not hardcoded) as an inline notice rather than a JS modal, since
 * this codebase has no dialog primitive built for inline notices. The
 * post-submit confirmation below does use a real <dialog> (mirroring the
 * one in EnlargeableImage.tsx) since the user asked for a popup specifically
 * confirming the submission went through.
 */
export default function TripRegistrationForm({
  tripPageId,
  currentPriceCents,
  packPaymentInstructions,
  troopPaymentInstructions,
  rsvpDeadlineLabel,
}: {
  tripPageId: string;
  currentPriceCents: number;
  packPaymentInstructions: string | null;
  troopPaymentInstructions: string | null;
  rsvpDeadlineLabel: string | null;
}) {
  const [affiliation, setAffiliation] = useState("");
  // Kept as strings (not numbers) so the field can go genuinely empty while
  // typing on mobile — type="number" inputs don't support .select()/select-
  // on-focus in any major mobile browser, so overwriting a pre-filled "0"
  // required deleting it first; a plain text input with a numeric keypad
  // (inputMode) does support selection, letting a tap-and-type replace it.
  const [payingCount, setPayingCount] = useState("1");
  const [freeCount, setFreeCount] = useState("0");
  const [state, formAction, isPending] = useActionState(registerForTripAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (state.success) {
      dialogRef.current?.showModal();
      formRef.current?.reset();
      setAffiliation("");
      setPayingCount("1");
      setFreeCount("0");
    }
  }, [state]);

  const totalCents = (Number(payingCount) || 0) * currentPriceCents;
  const notice = affiliation === "PACK" ? packPaymentInstructions : affiliation === "TROOP" ? troopPaymentInstructions : null;

  return (
    <>
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="tripPageId" value={tripPageId} />
        <div style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
          <label htmlFor="website">Leave this field blank</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {state.error && <div className="form-error">{state.error}</div>}

        <div className="form-field">
          <label htmlFor="familyName">Family / Registrant Name</label>
          <input id="familyName" name="familyName" required placeholder="e.g. The Smith Family" />
        </div>

        <div className="form-field">
          <label htmlFor="guestOfName">Scout/Leader You Are a Guest Of</label>
          <input id="guestOfName" name="guestOfName" required placeholder="e.g. Timmy Test (Wolf Den)" />
        </div>

        <div className="form-row">
          <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="contactEmail">Email</label>
            <input id="contactEmail" name="contactEmail" type="email" required />
          </div>
          <div className="form-field">
            <label htmlFor="contactPhone">Phone</label>
            <input id="contactPhone" name="contactPhone" type="tel" required placeholder="(212)555-1234" />
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="affiliation">Affiliated With</label>
          <select id="affiliation" name="affiliation" required value={affiliation} onChange={(e) => setAffiliation(e.target.value)}>
            <option value="" disabled>Select one…</option>
            <option value="PACK">Pack 376</option>
            <option value="TROOP">Troop 376</option>
          </select>
        </div>

        {notice && (
          <div className="info-card" style={{ background: "var(--cream)", marginBottom: 16, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{affiliation === "PACK" ? "Pack 376" : "Troop 376"} Payment Instructions</p>
            <p style={{ margin: "4px 0 0" }}>{notice}</p>
          </div>
        )}

        <div className="form-row">
          <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="payingCount">Attendees (paying)</label>
            <input
              id="payingCount"
              name="payingCount"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              value={payingCount}
              onChange={(e) => setPayingCount(e.target.value.replace(/\D/g, ""))}
              onFocus={(e) => e.target.select()}
            />
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="freeCount">Attendees (4 &amp; under, free)</label>
            <input
              id="freeCount"
              name="freeCount"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              value={freeCount}
              onChange={(e) => setFreeCount(e.target.value.replace(/\D/g, ""))}
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>

        <p className="form-note" style={{ fontSize: 15, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
          Total due: {(totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}
        </p>

        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={isPending}>
          {isPending ? "Submitting…" : "Register"}
        </button>
      </form>

      <dialog ref={dialogRef} className="confirm-dialog">
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🎉</p>
        <h3>Registration Submitted!</h3>
        <p>Thanks — your family is registered for Camp Conron.</p>
        {rsvpDeadlineLabel && (
          <p style={{ fontWeight: 700 }}>Please remember to make payment by {rsvpDeadlineLabel}!</p>
        )}
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 8 }}
        >
          Close
        </button>
      </dialog>
    </>
  );
}
