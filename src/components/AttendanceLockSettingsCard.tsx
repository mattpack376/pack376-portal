import { updateAttendanceLockRuleAction } from "@/lib/actions/attendance";
import {
  MAX_LOCK_DAYS_AFTER,
  attendanceLockRuleLabel,
  lockDayLabel,
  lockTimeInputValue,
  type AttendanceLockRule,
} from "@/lib/attendanceLock";
import SaveButton from "@/components/SaveButton";

/**
 * The master admin's control for when attendance locks to Admin-only after a
 * meeting (see attendanceLock.ts). Folded by default — the heading shows the
 * current setting, so it only needs opening to change it.
 */
export default function AttendanceLockSettingsCard({ rule }: { rule: AttendanceLockRule }) {
  const dayOptions = Array.from({ length: MAX_LOCK_DAYS_AFTER + 1 }, (_, days) => days);
  return (
    <div className="info-card" style={{ marginBottom: 20 }}>
      <details>
        <summary className="roster-summary">
          <h3>Attendance Lock Time</h3>
          <span className="badge-pill">{attendanceLockRuleLabel(rule)}</span>
        </summary>
        <p className="form-note" style={{ marginTop: 0, marginBottom: 16 }}>
          After this moment only Admins can change a meeting&apos;s attendance, No Meeting status or label. A change
          applies to every meeting right away, past ones included — a later time can reopen a meeting that had already
          locked. Only you can see this setting.
        </p>
        <form action={updateAttendanceLockRuleAction}>
          {/* The fields (not the form) are keyed on the saved value: React 19 resets the form after a save, and an
              uncontrolled <select> would snap back to the old day. Keying the form instead would remount SaveButton
              mid-save and lose its "Saved ✓" toast. */}
          <div className="form-row" key={`${rule.daysAfter}-${rule.minuteOfDay}`}>
            <div className="form-field">
              <label htmlFor="lock-days">Lock on</label>
              <select id="lock-days" name="daysAfter" defaultValue={String(rule.daysAfter)}>
                {dayOptions.map((days) => (
                  <option key={days} value={days}>
                    {lockDayLabel(days).replace(/^the /, "The ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="lock-time">At (Eastern time)</label>
              <input id="lock-time" name="lockTime" type="time" required defaultValue={lockTimeInputValue(rule.minuteOfDay)} />
            </div>
          </div>
          <SaveButton className="btn btn-primary btn-small">Save Lock Time</SaveButton>
        </form>
      </details>
    </div>
  );
}
