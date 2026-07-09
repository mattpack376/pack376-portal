"use client";

import { useState, useTransition } from "react";
import { toggleAdventureAction } from "@/lib/actions/advancement";
import type { ChecklistAdventure } from "@/lib/denData";

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

  return (
    <label className={`adventure-check-item${completed ? " completed" : ""}`}>
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
