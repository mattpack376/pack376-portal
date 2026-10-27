"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  registerForTripAction,
  type RegisterForTripState,
  type TripRegistrationField,
} from "@/lib/actions/tripRegistration";
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, MAX_PHONE_LENGTH } from "@/lib/formValues";

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
  registeredFor,
  freeAgeAndUnder,
  priceTbd,
}: {
  tripPageId: string;
  currentPriceCents: number;
  packPaymentInstructions: string | null;
  troopPaymentInstructions: string | null;
  rsvpDeadlineLabel: string | null;
  /** What the confirmation popup says the family registered for ("Camp Conron"). */
  registeredFor: string;
  /** Null when the event has no free tier — the free-attendees field is then left off. */
  freeAgeAndUnder: number | null;
  /** The price isn't released: no total is shown, and the confirmation says it will be posted. */
  priceTbd: boolean;
}) {
  const [state, formAction, isPending] = useActionState(registerForTripAction, {});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const errorId = useId();
  const dialogTitleId = useId();

  /*
   * Opening the <dialog> is the one thing here that belongs in an effect:
   * pushing React state out to a DOM API. state.submissionId changes only
   * when a submission goes through (see RegisterForTripState), so this fires
   * once per successful registration and never on a failed one.
   */
  useEffect(() => {
    if (state.success && state.submissionId) dialogRef.current?.showModal();
  }, [state.success, state.submissionId]);

  /*
   * Same reasoning for a refusal: focus moves to the message, so a keyboard
   * or screen-reader user hears what went wrong instead of being left on a
   * Register button that seems to have done nothing. Every result is a new
   * state object, so the same message twice in a row is focused both times.
   */
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  return (
    <>
      <form action={formAction}>
        <input type="hidden" name="tripPageId" value={tripPageId} />
        <div style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
          <label htmlFor="website">Leave this field blank</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {state.error && (
          <div ref={errorRef} id={errorId} className="form-error" role="alert" tabIndex={-1}>
            {state.error}
          </div>
        )}

        {/*
         * Clearing the form after a successful submission is this key, not an
         * effect: a new submissionId remounts the fields with their initial
         * state, which is exactly what "empty form, ready for the next
         * family" means. A failed submission keeps the previous id, so an
         * error leaves the attendee counts the visitor entered in place for
         * them to correct — and the name, email and phone too, which are
         * controlled for exactly that reason. (React resets a form's
         * uncontrolled inputs itself on any submit through an action, which
         * is why there's no reset() call to go with this.)
         */}
        <TripRegistrationFields
          key={state.submissionId ?? "first"}
          currentPriceCents={currentPriceCents}
          packPaymentInstructions={packPaymentInstructions}
          troopPaymentInstructions={troopPaymentInstructions}
          freeAgeAndUnder={freeAgeAndUnder}
          priceTbd={priceTbd}
          isPending={isPending}
          errorField={state.error ? state.field : undefined}
          errorId={errorId}
          result={state}
        />
      </form>

      <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby={dialogTitleId}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }} aria-hidden="true">
          🎉
        </p>
        <h3 id={dialogTitleId}>Registration Submitted!</h3>
        <p>Thanks — your family is registered for {registeredFor}.</p>
        {priceTbd ? (
          <p style={{ fontWeight: 700 }}>
            The price hasn&apos;t been released yet — we&apos;ll post it on this page, and your total will be filled in then.
          </p>
        ) : (
          rsvpDeadlineLabel && <p style={{ fontWeight: 700 }}>Please remember to make payment by {rsvpDeadlineLabel}!</p>
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

/**
 * The fields themselves, split out from the form so that remounting them
 * (see the key above) is what resets the ones that are controlled — the
 * name, email and phone (so a refused submission keeps them), the
 * affiliation driving the payment notice, and the two counts driving the
 * running total.
 */
function TripRegistrationFields({
  currentPriceCents,
  packPaymentInstructions,
  troopPaymentInstructions,
  freeAgeAndUnder,
  priceTbd,
  isPending,
  errorField,
  errorId,
  result,
}: {
  currentPriceCents: number;
  packPaymentInstructions: string | null;
  troopPaymentInstructions: string | null;
  freeAgeAndUnder: number | null;
  priceTbd: boolean;
  isPending: boolean;
  /** The field the current error is about, if it's about one: marked invalid and pointed at the message. */
  errorField: TripRegistrationField | undefined;
  /** The error message's id, for aria-describedby. */
  errorId: string;
  /** The latest result from the action — a new object after every submit. */
  result: RegisterForTripState;
}) {
  const [familyName, setFamilyName] = useState("");
  const [guestOfName, setGuestOfName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const affiliationRef = useRef<HTMLSelectElement>(null);
  // Kept as strings (not numbers) so the field can go genuinely empty while
  // typing on mobile — type="number" inputs don't support .select()/select-
  // on-focus in any major mobile browser, so overwriting a pre-filled "0"
  // required deleting it first; a plain text input with a numeric keypad
  // (inputMode) does support selection, letting a tap-and-type replace it.
  const [payingCount, setPayingCount] = useState("1");
  const [freeCount, setFreeCount] = useState("0");

  const totalCents = (Number(payingCount) || 0) * currentPriceCents;
  const notice = affiliation === "PACK" ? packPaymentInstructions : affiliation === "TROOP" ? troopPaymentInstructions : null;
  /*
   * React resets the form after every submit through an action. A controlled
   * text input survives that (React mirrors its value into the attribute the
   * reset restores), but a controlled <select> goes back to the option it
   * started on while its state still says "Pack 376" — so after a refusal it
   * showed "Select one…", and fixing the other field and resubmitting was
   * refused again for the affiliation. The reset has happened by the time
   * effects run, so this puts the select back to what the state says.
   */
  useEffect(() => {
    if (affiliationRef.current && affiliationRef.current.value !== affiliation) {
      affiliationRef.current.value = affiliation;
    }
  }, [result, affiliation]);

  /** aria-invalid/aria-describedby for one field, set only while the error is about it. */
  const errorProps = (field: TripRegistrationField) =>
    errorField === field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};

  return (
    <>
      <div className="form-field">
        <label htmlFor="familyName">Family / Registrant Name</label>
        <input
          id="familyName"
          name="familyName"
          required
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. The Smith Family"
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          {...errorProps("familyName")}
        />
      </div>

      <div className="form-field">
        <label htmlFor="guestOfName">Scout/Leader You Are a Guest Of</label>
        <input
          id="guestOfName"
          name="guestOfName"
          required
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. Timmy Test (Wolf Den)"
          value={guestOfName}
          onChange={(e) => setGuestOfName(e.target.value)}
          {...errorProps("guestOfName")}
        />
      </div>

      <div className="form-row">
        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="contactEmail">Email</label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            required
            maxLength={MAX_EMAIL_LENGTH}
            autoComplete="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            {...errorProps("contactEmail")}
          />
        </div>
        <div className="form-field">
          <label htmlFor="contactPhone">Phone</label>
          <input
            id="contactPhone"
            name="contactPhone"
            type="tel"
            required
            maxLength={MAX_PHONE_LENGTH}
            autoComplete="tel"
            placeholder="(212)555-1234"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            {...errorProps("contactPhone")}
          />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="affiliation">Affiliated With</label>
        <select
          ref={affiliationRef}
          id="affiliation"
          name="affiliation"
          required
          value={affiliation}
          onChange={(e) => setAffiliation(e.target.value)}
          {...errorProps("affiliation")}
        >
          {/*
           * Disabled only once there's something to go back from. A disabled
           * placeholder can't be what a browser lands on when it resets a
           * form (it skips to the first option that isn't disabled — here,
           * Pack 376), and React resets this form on every submit, so an
           * always-disabled placeholder leaves a freshly cleared form showing
           * "Pack 376" while nothing is actually chosen.
           */}
          <option value="" disabled={affiliation !== ""}>Select one…</option>
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
            {...errorProps("payingCount")}
          />
        </div>
        {freeAgeAndUnder !== null ? (
          <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="freeCount">Attendees ({freeAgeAndUnder} &amp; under, free)</label>
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
              {...errorProps("freeCount")}
            />
          </div>
        ) : (
          <input type="hidden" name="freeCount" value="0" />
        )}
      </div>

      <p className="form-note" style={{ fontSize: 15, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
        {priceTbd
          ? "Total due: TBD (price not released yet)"
          : `Total due: ${(totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
      </p>

      <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={isPending}>
        {isPending ? "Submitting…" : "Register"}
      </button>
    </>
  );
}
