import type { ChecklistAdventure } from "@/lib/denData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import { formatDateOnly } from "@/lib/dateOnly";

export default function AdventureCheckbox({
  adventure,
  checked,
  completedDate,
  awardedDate,
  dirty,
  editable,
  disabled,
  onToggle,
  onEditDates,
}: {
  adventure: ChecklistAdventure;
  checked: boolean;
  /** Draft values — what the row will hold once Apply Changes is pressed. */
  completedDate: string | null;
  awardedDate: string | null;
  dirty: boolean;
  editable: boolean;
  disabled: boolean;
  onToggle: () => void;
  onEditDates: () => void;
}) {
  const tooltip = adventure.updatedAt
    ? formatAuditTooltip(
        adventure.completed ? "Checked" : "Unchecked",
        adventure.updatedAt,
        adventure.updatedByUsername
      )
    : null;

  return (
    /*
     * The label wraps only the checkbox and name: the dates button sits
     * outside it so clicking it opens the dialog instead of toggling the box.
     */
    <div
      className={`adventure-check-item audit-hover${checked ? " completed" : ""}${
        dirty ? " pending-change" : ""
      }`}
      data-audit={tooltip ?? undefined}
    >
      <label className="adventure-check-main">
        <input
          type="checkbox"
          checked={checked}
          disabled={!editable || disabled}
          onChange={onToggle}
        />
        <span>
          {adventure.name}
          {adventure.note && <span className="adventure-note">{adventure.note}</span>}
        </span>
      </label>

      {checked && (
        <div className="adventure-dates">
          <span className="adventure-date-line">
            Completed {completedDate ? formatDateOnly(completedDate) : "— date not recorded"}
          </span>
          <span className={`adventure-date-line${awardedDate ? "" : " pending-award"}`}>
            {awardedDate ? `Awarded ${formatDateOnly(awardedDate)}` : "Not yet awarded"}
          </span>
          {editable && (
            <button type="button" className="btn-link" disabled={disabled} onClick={onEditDates}>
              {awardedDate ? "Edit dates" : "Add award date"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
