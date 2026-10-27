import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { registerMyGuestGroupForEventAction } from "@/lib/actions/events";
import { MAX_NAME_LENGTH } from "@/lib/formValues";
import { SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE, newSubmissionKey } from "@/lib/guestGroupLimits";

/**
 * The "sign up yourself and your guests" form for one event, on the Parent
 * Dashboard and on Family View. A server component: each time the page
 * renders, the form gets a fresh submission key, so sending this form twice
 * makes one group while the next rendering (after it saved) can add another.
 * A refusal (too many people, sign-up closed, the per-event limit) shows
 * above the fields.
 */
export default function GuestSelfRegistrationForm({
  eventId,
  nameLabel,
  defaultName,
  adults,
  kids,
  submitLabel,
  submitClassName,
}: {
  eventId: string;
  nameLabel: string;
  defaultName: string;
  /** Whether the event takes adult guests (it has an adult fee). */
  adults: boolean;
  /** Whether the event takes guest children (it has a guest child fee). */
  kids: boolean;
  submitLabel: string;
  submitClassName: string;
}) {
  return (
    <ActionForm action={registerMyGuestGroupForEventAction}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="submissionKey" value={newSubmissionKey()} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="form-field" style={{ marginBottom: 0, flex: "1 1 200px" }}>
          <label htmlFor={`familyName-${eventId}`}>{nameLabel}</label>
          <input
            id={`familyName-${eventId}`}
            name="familyName"
            required
            maxLength={MAX_NAME_LENGTH}
            defaultValue={defaultName.slice(0, MAX_NAME_LENGTH)}
          />
        </div>
        {adults && (
          <div className="form-field" style={{ marginBottom: 0, flex: "1 1 90px" }}>
            <label htmlFor={`adultCount-${eventId}`}>Adults</label>
            <input
              id={`adultCount-${eventId}`}
              name="adultCount"
              type="number"
              min="0"
              max={SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE}
              step="1"
              defaultValue={1}
            />
          </div>
        )}
        {kids && (
          <div className="form-field" style={{ marginBottom: 0, flex: "1 1 90px" }}>
            <label htmlFor={`childCount-${eventId}`}>Kids</label>
            <input
              id={`childCount-${eventId}`}
              name="childCount"
              type="number"
              min="0"
              max={SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE}
              step="1"
              defaultValue={0}
            />
          </div>
        )}
        <SubmitButton className={submitClassName} pendingLabel="Signing up…">
          {submitLabel}
        </SubmitButton>
      </div>
      <p className="form-note" style={{ marginTop: 6, marginBottom: 0 }}>
        Up to {SELF_SERVICE_GUEST_GROUP_MAX_PEOPLE} people per group. For a bigger group, ask an Admin to register it.
      </p>
    </ActionForm>
  );
}
