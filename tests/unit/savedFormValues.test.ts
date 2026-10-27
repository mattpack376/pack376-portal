import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { centsFieldText, isUnchangedText, textLengthAsTyped } from "@/lib/savedFormValues";

describe("saved form values", () => {
  it("show an amount the way the edit forms fill it in", () => {
    assert.equal(centsFieldText(0), "0.00");
    assert.equal(centsFieldText(4550), "45.50");
    assert.equal(centsFieldText(250_000_000), "2500000.00");
    assert.equal(centsFieldText(2_147_483_647), "21474836.47");
  });

  it("count a line break as one character, however it was sent", () => {
    assert.equal(textLengthAsTyped(""), 0);
    assert.equal(textLengthAsTyped("ab"), 2);
    assert.equal(textLengthAsTyped("a\r\nb"), 3);
    assert.equal(textLengthAsTyped("a\nb"), 3);
    assert.equal(textLengthAsTyped("a\rb"), 3);
    assert.equal(textLengthAsTyped("a\r\n\r\nb"), 4);
  });

  it("call text unchanged only when it matches what was saved, edges and line breaks aside", () => {
    assert.ok(isUnchangedText("Spring Campout", "Spring Campout"));
    assert.ok(isUnchangedText("  Spring Campout ", "Spring Campout"));
    assert.ok(isUnchangedText("one\r\ntwo", "one\ntwo"));
    assert.ok(isUnchangedText("one\ntwo", "one\r\ntwo\r\n"));
    assert.equal(isUnchangedText("Spring Campout!", "Spring Campout"), false);
    assert.equal(isUnchangedText("one two", "one\ntwo"), false);
    assert.equal(isUnchangedText("spring campout", "Spring Campout"), false);
    assert.equal(isUnchangedText("", null), false);
    assert.equal(isUnchangedText("anything", undefined), false);
  });
});
