import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_CENTS,
  dollarsToCents,
  hasControlCharacters,
  isValidEmail,
  multiplyCents,
  parseCount,
  textField,
} from "@/lib/formValues";

describe("dollarsToCents", () => {
  it("converts ordinary amounts", () => {
    assert.equal(dollarsToCents("45"), 4500);
    assert.equal(dollarsToCents("45.5"), 4550);
    assert.equal(dollarsToCents("45.50"), 4550);
    assert.equal(dollarsToCents(".5"), 50);
    assert.equal(dollarsToCents("0"), 0);
    assert.equal(dollarsToCents(" 12.34 "), 1234);
    assert.equal(dollarsToCents("19.99"), 1999); // no float drift
    assert.equal(dollarsToCents("1000000"), MAX_CENTS);
  });

  it("rejects blanks, negatives and other spellings", () => {
    for (const raw of ["", " ", "-5", "1e3", "0x10", "Infinity", "NaN", "$5", "1,000", "4.555", "5 5", "+5", "."]) {
      assert.equal(dollarsToCents(raw), null, raw);
    }
  });

  it("rejects amounts past the ceiling without float tricks", () => {
    assert.equal(dollarsToCents("1000000.01"), null);
    assert.equal(dollarsToCents("99999999"), null);
    assert.equal(dollarsToCents("9".repeat(400)), null);
  });
});

describe("parseCount", () => {
  it("reads plain whole numbers, blank as 0", () => {
    assert.equal(parseCount("3"), 3);
    assert.equal(parseCount(" 07 "), 7);
    assert.equal(parseCount(""), 0);
    assert.equal(parseCount(null), 0);
  });

  it("rejects other spellings and files", () => {
    for (const raw of ["-1", "1.5", "2.0", "1e3", "0x10", "+3", "abc", "1 0"]) {
      assert.equal(parseCount(raw), null, raw);
    }
    assert.equal(parseCount(new File(["5"], "count.txt")), null);
  });

  it("enforces the caller's ceiling", () => {
    assert.equal(parseCount("10", 10), 10);
    assert.equal(parseCount("11", 10), null);
    assert.equal(parseCount("100000"), null); // default ceiling
    assert.equal(parseCount("9999999999"), null);
  });
});

describe("multiplyCents", () => {
  it("multiplies within the ceiling", () => {
    assert.equal(multiplyCents(4, 2500), 10000);
    assert.equal(multiplyCents(0, 2500), 0);
  });
  it("refuses totals past the ceiling", () => {
    assert.equal(multiplyCents(100_001, 1000), null);
    assert.equal(multiplyCents(Number.MAX_SAFE_INTEGER, 2), null);
  });
});

describe("isValidEmail", () => {
  it("accepts one plain mailbox", () => {
    assert.equal(isValidEmail("parent@example.com"), true);
    assert.equal(isValidEmail("first.last+pack@sub.example.org"), true);
  });
  it("rejects lists, display names, markup and oversize input", () => {
    for (const raw of [
      "a@b.com, c@d.com",
      "a@b.com;c@d.com",
      "Name <a@b.com>",
      "<a@b.com>",
      "a b@c.com",
      "a@b",
      "@b.com",
      'a"@b.com',
      `${"a".repeat(250)}@b.com`,
      "a\u0000@b.com",
      "a@b.com\u0007",
      "a@b\u0085.com",
    ]) {
      assert.equal(isValidEmail(raw), false, raw);
    }
  });
});

describe("hasControlCharacters", () => {
  it("flags NUL, line breaks and other control characters", () => {
    for (const raw of ["a\u0000b", "line\nbreak", "cr\r", "tab\t", "del\u007f", "c1\u0085"]) {
      assert.equal(hasControlCharacters(raw), true, JSON.stringify(raw));
    }
  });
  it("leaves ordinary names alone", () => {
    for (const raw of ["Frank Interdonatti", "O'Brien-Smith", "José Hernández", "Zoë & Ana <3"]) {
      assert.equal(hasControlCharacters(raw), false, raw);
    }
  });
});

describe("textField", () => {
  it("trims strings and ignores files", () => {
    assert.equal(textField("  Smith  "), "Smith");
    assert.equal(textField(null), "");
    assert.equal(textField(new File(["x"], "x.txt")), "");
  });
});
