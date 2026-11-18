"use client";

import { useMemo } from "react";
import type { ChecklistAdventure } from "@/lib/denData";
import { formatDateOnly } from "@/lib/dateOnly";
import {
  buildRequirementTree,
  isCheckable,
  latestDate,
  requirementProgress,
  type RequirementNode,
} from "@/lib/requirementProgress";

/** One requirement's draft: what Apply Changes will write. */
export type RequirementDraft = { completed: boolean; completedDate: string | null };

/*
 * The collapsed "Requirements · 3 of 5" expander under one adventure. Checks
 * here only feed the card's draft — nothing saves until Apply Changes — and
 * they never complete the adventure on their own: once every requirement is
 * met the leader is offered the adventure's usual dates dialog instead.
 */
export default function AdventureRequirements({
  adventure,
  adventureChecked,
  draft,
  saved,
  editable,
  disabled,
  onToggle,
  onDateChange,
  onMarkComplete,
}: {
  adventure: ChecklistAdventure;
  /** The adventure checkbox as drafted. */
  adventureChecked: boolean;
  draft: Record<string, RequirementDraft>;
  saved: Record<string, RequirementDraft>;
  editable: boolean;
  disabled: boolean;
  onToggle: (requirementId: string) => void;
  onDateChange: (requirementId: string, date: string) => void;
  /** Open the adventure's dates dialog, its completion date prefilled. */
  onMarkComplete: (completedDate: string | null) => void;
}) {
  const tree = useMemo(() => buildRequirementTree(adventure.requirements), [adventure.requirements]);
  if (tree.length === 0) return null;

  const checkedIds = new Set(adventure.requirements.filter((r) => draft[r.id]?.completed).map((r) => r.id));
  const progress = requirementProgress(tree, adventure.requirementsPick, checkedIds);
  const unsaved = adventure.requirements.some((r) => !sameDraft(draft[r.id], saved[r.id]));
  // An adventure checked off before requirements were tracked: say so rather than "0 of 5".
  const legacy = adventureChecked && !progress.anyChecked;

  const renderNodes = (nodes: RequirementNode[]) => (
    <ul className="req-list">
      {nodes.map((node) => (
        <li key={node.id}>{isCheckable(node) ? renderCheckable(node) : renderParent(node)}</li>
      ))}
    </ul>
  );

  const renderParent = (node: RequirementNode) => (
    <div className="req-parent">
      <div className="req-parent-text">
        <span className="req-code">{node.code}.</span> {node.text}
        {node.pick !== null && node.pick < node.children.length && (
          <span className="req-pick-note">
            {" "}
            (any {node.pick} of {node.children.length})
          </span>
        )}
      </div>
      {renderNodes(node.children)}
    </div>
  );

  const renderCheckable = (node: RequirementNode) => {
    const current = draft[node.id] ?? EMPTY;
    const dirty = !sameDraft(current, saved[node.id]);
    return (
      <div className={`req-item${current.completed ? " completed" : ""}${dirty ? " pending-change" : ""}`}>
        <label className="req-check">
          <input
            type="checkbox"
            checked={current.completed}
            disabled={!editable || disabled}
            onChange={() => onToggle(node.id)}
          />
          <span>
            <span className="req-code">{node.code}.</span> {node.text}
          </span>
        </label>
        {current.completed &&
          (editable ? (
            <label className="req-date">
              <span>Done on</span>
              <input
                type="date"
                value={current.completedDate ?? ""}
                disabled={disabled}
                required
                aria-label={`Date requirement ${node.code} was done`}
                onChange={(e) => onDateChange(node.id, e.target.value)}
              />
            </label>
          ) : (
            <span className="req-date-line">
              Done {current.completedDate ? formatDateOnly(current.completedDate) : "— date not recorded"}
            </span>
          ))}
      </div>
    );
  };

  const summary = legacy
    ? "Completed (requirements not logged individually)"
    : `${progress.met} of ${progress.needed}${progress.needed < progress.total ? ` (of ${progress.total})` : ""}`;

  return (
    <details className="req-expander">
      <summary className="req-summary">
        <span className="req-summary-label">Requirements</span>
        <span className={`req-summary-count${progress.allMet ? " all-met" : ""}`}>{summary}</span>
        {unsaved && <span className="req-summary-unsaved">Unsaved</span>}
      </summary>

      <div className="req-body">
        {adventure.requirementsNote && <p className="req-note">{adventure.requirementsNote}</p>}
        {adventure.requirementsPick !== null && adventure.requirementsPick < tree.length && (
          <p className="req-note">
            Complete any {adventure.requirementsPick} of these {tree.length}.
          </p>
        )}
        {legacy && (
          <p className="req-note">
            This adventure was checked off before requirements were tracked one by one. You can still
            check them below; the adventure stays complete either way.
          </p>
        )}

        {renderNodes(tree)}

        {editable && progress.allMet && !adventureChecked && (
          <div className="req-all-met">
            <span>All requirements met — mark the adventure complete?</span>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={disabled}
              onClick={() =>
                onMarkComplete(latestDate([...checkedIds].map((id) => draft[id]?.completedDate)))
              }
            >
              Mark Complete…
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

const EMPTY: RequirementDraft = { completed: false, completedDate: null };

export function sameDraft(a: RequirementDraft | undefined, b: RequirementDraft | undefined) {
  const x = a ?? EMPTY;
  const y = b ?? EMPTY;
  return x.completed === y.completed && (x.completed ? x.completedDate === y.completedDate : true);
}
