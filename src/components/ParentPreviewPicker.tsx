"use client";

import { useRouter } from "next/navigation";

export type PreviewScoutOption = { id: string; name: string; den: string; hasParentLogin: boolean };

/**
 * Picks a scout whose family's Parent Dashboard to preview. Grouped by den
 * because that is how leaders think about the roster, and a pack-wide flat
 * list of every scout is long enough to be hard to scan.
 */
export default function ParentPreviewPicker({
  scouts,
  selected,
  basePath,
}: {
  scouts: PreviewScoutOption[];
  selected?: string;
  basePath: string;
}) {
  const router = useRouter();

  const byDen = scouts.reduce<Map<string, PreviewScoutOption[]>>((acc, s) => {
    if (!acc.has(s.den)) acc.set(s.den, []);
    acc.get(s.den)!.push(s);
    return acc;
  }, new Map());

  return (
    <div className="form-field no-print" style={{ maxWidth: 340, marginBottom: 24 }}>
      <label htmlFor="parent-preview-scout">See a family&apos;s Parent Dashboard</label>
      <select
        id="parent-preview-scout"
        value={selected ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          router.push(id ? `${basePath}?previewScoutId=${id}` : basePath);
        }}
      >
        <option value="">— Full Family View —</option>
        {[...byDen.entries()].map(([den, group]) => (
          <optgroup key={den} label={den}>
            {group.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.hasParentLogin ? "" : " (no parent login)"}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="form-note">Read-only — sign-in isn&apos;t needed and nothing can be submitted from it.</p>
    </div>
  );
}
