"use client";

import { useState, useTransition } from "react";
import { toggleAdventureAction } from "@/lib/actions/advancement";
import type { ChecklistAdventure } from "@/lib/denData";
import { formatAuditTooltip } from "@/lib/auditTooltip";

export default function AdventureCheckbox({
  scoutId,
  adventure,
  editable,
}: {
  scoutId: string;
  adventure: ChecklistAdventure;
  editable: boolean;
}) {
  const [completed, setCompleted] = useState(adventure.completed);
  const [isPending, startTransition] = useTransition();

  function handleChange() {
    if (!editable) return;
    const next = !completed;
    setCompleted(next);
    startTransition(async () => {
      const result = await toggleAdventureAction(scoutId, adventure.id, next);
      if (!result.ok) setCompleted(!next);
    });
  }

  const tooltip = adventure.updatedAt
    ? formatAuditTooltip(
        completed ? "Checked" : "Unchecked",
        adventure.updatedAt,
        adventure.updatedByUsername
      )
    : null;

  return (
    <label
      className={`adventure-check-item audit-hover${completed ? " completed" : ""}`}
      data-audit={tooltip ?? undefined}
    >
      <input
        type="checkbox"
        checked={completed}
        disabled={!editable || isPending}
        onChange={handleChange}
      />
      <span>
        {adventure.name}
        {adventure.note && <span className="adventure-note">{adventure.note}</span>}
      </span>
    </label>
  );
}
