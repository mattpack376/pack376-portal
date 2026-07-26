import type { ChecklistAdventure } from "@/lib/denData";
import { formatAuditTooltip } from "@/lib/auditTooltip";

export default function AdventureCheckbox({
  adventure,
  checked,
  dirty,
  editable,
  disabled,
  onToggle,
}: {
  adventure: ChecklistAdventure;
  checked: boolean;
  dirty: boolean;
  editable: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const tooltip = adventure.updatedAt
    ? formatAuditTooltip(
        adventure.completed ? "Checked" : "Unchecked",
        adventure.updatedAt,
        adventure.updatedByUsername
      )
    : null;

  return (
    <label
      className={`adventure-check-item audit-hover${checked ? " completed" : ""}${
        dirty ? " pending-change" : ""
      }`}
      data-audit={tooltip ?? undefined}
    >
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
  );
}
