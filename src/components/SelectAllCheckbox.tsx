"use client";

/**
 * Ticks or unticks every checkbox named `name` that belongs to the form `form`
 * (by its form="" attribute, so the boxes can sit in table rows outside it).
 * Without JavaScript it does nothing, and each row's own box still works.
 */
export default function SelectAllCheckbox({ form, name, label }: { form: string; name: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      onChange={(event) => {
        const checked = event.currentTarget.checked;
        document
          .querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${form}"][name="${name}"]`)
          .forEach((box) => {
            box.checked = checked;
          });
      }}
    />
  );
}
