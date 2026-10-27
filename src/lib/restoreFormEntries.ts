/*
 * Puts what someone typed back into a form after a save was turned down.
 *
 * React resets a form's fields after every submit through an action — on a
 * refusal too — so without this, an admin told "Enter a valid email address"
 * finds every field of "Add a family by hand" blank again, and an upload
 * refused for size takes the Event Details edits with it. TripAdminForm calls
 * this once the refusal has rendered, with the FormData that was submitted.
 *
 * Text, number, date and email fields, text areas, selects, checkboxes and
 * radio buttons are restored; hidden fields (ids, quoted prices) keep what the
 * refreshed page rendered, and a chosen file can't be put back, so it has to
 * be picked again. Each restored field gets the input and change events a
 * person typing would fire: that is how a SaveButton notices the form still
 * differs from what's saved, and how a controlled text field's own state
 * follows. (A controlled checkbox would need a click instead; the trip admin
 * forms' checkboxes are all uncontrolled.)
 */

/** Inputs whose value isn't something typed, or can't be set from script. */
const NOT_RESTORED = new Set(["hidden", "file", "submit", "reset", "button", "image"]);

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isField(element: Element): element is Field {
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
}

export function restoreFormEntries(form: HTMLFormElement, entries: FormData): void {
  // How many fields of each name have been passed so far, so the second of
  // two same-named fields gets the second value — counted over every field
  // that contributes to FormData, hidden and file ones included, so the
  // positions line up with entries.getAll(name).
  const position = new Map<string, number>();

  for (const element of Array.from(form.elements)) {
    if (!isField(element) || !element.name || element.disabled) continue;
    const type = element.tagName === "INPUT" ? (element as HTMLInputElement).type : "";
    if (type === "submit" || type === "reset" || type === "button" || type === "image") continue;

    if (type === "checkbox" || type === "radio") {
      const input = element as HTMLInputElement;
      const checked = entries.getAll(input.name).includes(input.value);
      if (input.checked !== checked) {
        setThroughPrototype(input, "checked", checked);
        announce(input);
      }
      continue;
    }

    const index = position.get(element.name) ?? 0;
    position.set(element.name, index + 1);
    if (NOT_RESTORED.has(type)) continue;

    const value = entries.getAll(element.name)[index];
    if (typeof value !== "string" || element.value === value) continue;
    setThroughPrototype(element, "value", value);
    announce(element);
  }
}

/**
 * Sets a field's value (or checked state) the way the browser does when
 * someone types. React keeps its own record of a controlled field's value on
 * the element and ignores an input event that doesn't change it; writing
 * through the prototype's setter leaves that record alone, so the event
 * reaches the field's onChange — the same way testing tools fill in React
 * forms. For an uncontrolled field it is just an ordinary assignment.
 */
function setThroughPrototype(element: Field, property: "value" | "checked", value: string | boolean) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), property)?.set;
  if (setter) setter.call(element, value);
  else (element as unknown as Record<string, unknown>)[property] = value;
}

function announce(element: Field) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
