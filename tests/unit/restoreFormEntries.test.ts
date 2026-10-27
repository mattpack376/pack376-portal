/*
 * restoreFormEntries puts a refused trip admin form's entries back after
 * React resets it (TripAdminForm). There's no DOM here, so the fields are
 * small stand-ins with the same shape: value/checked accessors on the
 * prototype, as the browser's are, and — for a "controlled" field — an
 * own-property `value` that records writes the way React's value tracker
 * does. The real React behaviour (a controlled field's onChange firing) was
 * checked in a browser; this pins down which fields get which value.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restoreFormEntries } from "@/lib/restoreFormEntries";

class FakeField extends EventTarget {
  disabled = false;
  fired: string[] = [];
  private currentValue: string;
  private currentChecked = false;

  constructor(
    readonly tagName: "INPUT" | "TEXTAREA" | "SELECT",
    readonly name: string,
    readonly type: string,
    value = "",
  ) {
    super();
    this.currentValue = value;
    for (const kind of ["input", "change"]) this.addEventListener(kind, (event) => this.fired.push(`${event.type}${event.bubbles ? "↑" : ""}`));
  }

  get value() {
    return this.currentValue;
  }
  set value(next: string) {
    this.currentValue = next;
  }
  get checked() {
    return this.currentChecked;
  }
  set checked(next: boolean) {
    this.currentChecked = next;
  }
}

const input = (name: string, type = "text", value = "") => new FakeField("INPUT", name, type, value);
const checkbox = (name: string, value: string, checked = false) => {
  const box = new FakeField("INPUT", name, "checkbox", value);
  box.checked = checked;
  return box;
};

/** Gives a field an own `value` the way React's tracker does, recording what was assigned through it. */
function trackLikeReact(field: FakeField) {
  const tracked: string[] = [];
  const proto = Object.getOwnPropertyDescriptor(FakeField.prototype, "value")!;
  Object.defineProperty(field, "value", {
    configurable: true,
    get() {
      return proto.get!.call(this);
    },
    set(next: string) {
      tracked.push(next);
      proto.set!.call(this, next);
    },
  });
  return tracked;
}

function restore(fields: FakeField[], entries: Record<string, string | string[] | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
  }
  restoreFormEntries({ elements: fields } as unknown as HTMLFormElement, data);
}

describe("restoreFormEntries", () => {
  it("puts typed values back into text fields, text areas and selects, announcing each change", () => {
    const name = input("familyName");
    const email = input("contactEmail", "email");
    const details = new FakeField("TEXTAREA", "detailsHtml", "", "As loaded");
    const affiliation = new FakeField("SELECT", "affiliation", "", "PACK");
    restore([name, email, details, affiliation], {
      familyName: "The Smith Family",
      contactEmail: "smith@example",
      detailsHtml: "Edited details",
      affiliation: "TROOP",
    });
    assert.deepEqual(
      [name.value, email.value, details.value, affiliation.value],
      ["The Smith Family", "smith@example", "Edited details", "TROOP"],
    );
    for (const field of [name, email, details, affiliation]) assert.deepEqual(field.fired, ["input↑", "change↑"]);
  });

  it("leaves hidden and file inputs to the refreshed page, and skips buttons", () => {
    const id = input("id", "hidden", "trip-1");
    const quoted = input("chargePricePerPersonCents", "hidden", "4500");
    const flyer = input("flyer", "file");
    const save = input("save", "submit", "Save");
    restore([id, quoted, flyer, save], { id: "trip-old", chargePricePerPersonCents: "4000", flyer: new File(["x"], "f.pdf"), save: "x" });
    assert.deepEqual([id.value, quoted.value, flyer.value, save.value], ["trip-1", "4500", "", "Save"]);
    for (const field of [id, quoted, flyer, save]) assert.deepEqual(field.fired, []);
  });

  it("matches same-named fields by position, hidden ones included", () => {
    const hidden = input("freeCount", "hidden", "0");
    const first = input("menu");
    const second = input("menu");
    restore([hidden, first, second], { freeCount: "0", menu: ["Pancakes", "Chili"] });
    assert.equal(first.value, "Pancakes");
    assert.equal(second.value, "Chili");

    // A hidden field ahead of a visible one with the same name keeps them aligned.
    const hiddenMenu = input("menu", "hidden", "ignored");
    const visibleMenu = input("menu");
    restore([hiddenMenu, visibleMenu], { menu: ["ignored", "Tacos"] });
    assert.equal(visibleMenu.value, "Tacos");
    assert.equal(hiddenMenu.value, "ignored");
  });

  it("checks exactly the checkboxes that were submitted checked", () => {
    const tbd = checkbox("priceTbd", "true", true);
    const remove = checkbox("removeFlyer", "true", false);
    const untouched = checkbox("other", "true", true);
    restore([tbd, remove, untouched], { removeFlyer: "true", other: "true" });
    assert.equal(tbd.checked, false, "unchecked when it wasn't submitted");
    assert.equal(remove.checked, true);
    assert.equal(untouched.checked, true);
    assert.deepEqual(tbd.fired, ["input↑", "change↑"]);
    assert.deepEqual(untouched.fired, [], "no event for a box already as submitted");
  });

  it("skips disabled fields, which a form never submits", () => {
    const disabled = input("note", "text", "kept");
    disabled.disabled = true;
    const after = input("note");
    restore([disabled, after], { note: "typed" });
    assert.equal(disabled.value, "kept");
    assert.equal(after.value, "typed", "the first submitted value goes to the first enabled field");
  });

  it("doesn't touch or announce a field already showing what was submitted", () => {
    const same = input("title", "text", "Camp Conron");
    restore([same], { title: "Camp Conron" });
    assert.deepEqual(same.fired, []);
  });

  it("writes around a controlled field's own value record, so its onChange sees the change", () => {
    const count = input("payingCount", "text", "2");
    const tracked = trackLikeReact(count);
    restore([count], { payingCount: "3" });
    assert.equal(count.value, "3");
    assert.deepEqual(tracked, [], "set through the prototype, not the field's own setter");
    assert.deepEqual(count.fired, ["input↑", "change↑"]);
  });
});
