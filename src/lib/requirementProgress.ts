/**
 * How far a scout is through one adventure's requirements. Pure, so the
 * card (client), the server action and the unit tests all count the same way.
 *
 * A requirement is met when it's a checked leaf, or — when it has children
 * (lettered parts, or a "do two of 4-7" group) — when `pick` of its children
 * are met, all of them if pick is null. An adventure's requirements are met
 * when its top-level requirements satisfy the adventure's own pick.
 *
 * Meeting every requirement never completes the adventure by itself: the
 * adventure checkbox (AdvancementRecord) stays the source of truth, and the
 * card only offers to check it.
 */

export type RequirementRow = {
  id: string;
  parentId: string | null;
  code: string;
  text: string;
  pick: number | null;
  isGroup: boolean;
  sortOrder: number;
};

export type RequirementNode = Omit<RequirementRow, "parentId" | "sortOrder"> & {
  children: RequirementNode[];
};

/** Flat rows (any order) → the tree, each level in sortOrder. A row whose parent is missing is dropped. */
export function buildRequirementTree(rows: readonly RequirementRow[]): RequirementNode[] {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const nodes = new Map<string, RequirementNode>();
  for (const row of sorted) {
    nodes.set(row.id, { id: row.id, code: row.code, text: row.text, pick: row.pick, isGroup: row.isGroup, children: [] });
  }
  const roots: RequirementNode[] = [];
  for (const row of sorted) {
    const node = nodes.get(row.id)!;
    if (row.parentId === null) roots.push(node);
    else nodes.get(row.parentId)?.children.push(node);
  }
  return roots;
}

/** True for a requirement that gets its own checkbox: no children and not a group wrapper. */
export function isCheckable(node: RequirementNode): boolean {
  return !node.isGroup && node.children.length === 0;
}

/** Every checkable requirement in the tree, top to bottom. */
export function checkableRequirements(nodes: readonly RequirementNode[]): RequirementNode[] {
  return nodes.flatMap((node) => (isCheckable(node) ? [node] : checkableRequirements(node.children)));
}

/** How many of a node list are needed: pick, capped at the list length, or all of them. */
function needed(count: number, pick: number | null): number {
  return pick === null ? count : Math.min(Math.max(pick, 0), count);
}

export function isRequirementMet(node: RequirementNode, checked: ReadonlySet<string>): boolean {
  if (isCheckable(node)) return checked.has(node.id);
  // A group with nothing under it can't be met — an empty list would otherwise count as "all done".
  if (node.children.length === 0) return false;
  const met = node.children.filter((child) => isRequirementMet(child, checked)).length;
  return met >= needed(node.children.length, node.pick);
}

export type RequirementProgress = {
  /** Top-level requirements met. */
  met: number;
  /** Top-level requirements needed to earn the adventure. */
  needed: number;
  /** Top-level requirements listed. */
  total: number;
  allMet: boolean;
  /** Whether any requirement at all is checked (false = none logged). */
  anyChecked: boolean;
};

export function requirementProgress(
  nodes: readonly RequirementNode[],
  adventurePick: number | null,
  checked: ReadonlySet<string>,
): RequirementProgress {
  const met = nodes.filter((node) => isRequirementMet(node, checked)).length;
  const need = needed(nodes.length, adventurePick);
  return {
    met,
    needed: need,
    total: nodes.length,
    allMet: nodes.length > 0 && met >= need,
    anyChecked: checkableRequirements(nodes).some((node) => checked.has(node.id)),
  };
}

/** The latest of some YYYY-MM-DD dates (they sort as strings), or null when there are none. */
export function latestDate(dates: readonly (string | null | undefined)[]): string | null {
  let latest: string | null = null;
  for (const date of dates) if (date && (latest === null || date > latest)) latest = date;
  return latest;
}
