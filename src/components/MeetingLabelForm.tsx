"use client";

import { setMeetingLabelAction } from "@/lib/actions/attendance";
import { MEETING_LABEL_MAX_LENGTH } from "@/lib/meetingLabel";
import SaveButton from "@/components/SaveButton";

/**
 * The label beside a meeting date on every attendance list ("Camp Conron",
 * "Halloween Pack Night"). Shared by the scout and leader meeting pages — it's
 * the same MeetingDate either way, so setting it in one shows in both.
 */
export default function MeetingLabelForm({ meetingDateId, label }: { meetingDateId: string; label: string | null }) {
  return (
    <form action={setMeetingLabelAction.bind(null, meetingDateId)} className="meeting-label-form">
      <div className="form-field">
        <label htmlFor="meeting-label">Label for this date</label>
        <input
          id="meeting-label"
          name="label"
          type="text"
          defaultValue={label ?? ""}
          maxLength={MEETING_LABEL_MAX_LENGTH}
          placeholder="e.g. Halloween Pack Night"
          autoComplete="off"
        />
      </div>
      <SaveButton className="btn btn-primary btn-small">Save Label</SaveButton>
      <p className="form-note">
        Shown beside the date on every attendance list and in the CSV exports. Leave it blank for an ordinary meeting.
      </p>
    </form>
  );
}
