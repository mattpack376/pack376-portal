import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import {
  MAX_PASSWORD_BYTES,
  MAX_PASSWORD_INPUT_LENGTH,
  isWellFormedResetToken,
  newPasswordProblem,
  oversizePasswordProblem,
  utf8ByteLength,
} from "@/lib/credentialInput";

describe("isWellFormedResetToken", () => {
  it("accepts the shape every issued link has", () => {
    for (let i = 0; i < 50; i++) {
      assert.equal(isWellFormedResetToken(randomBytes(32).toString("base64url")), true);
    }
  });

  it("rejects anything else without looking further", () => {
    for (const token of [
      "",
      "short",
      "A".repeat(42),
      "A".repeat(44),
      "A".repeat(100_000),
      `${"A".repeat(43)}${"!".repeat(100_000)}`,
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}+`,
      `${"A".repeat(42)}/`,
      ` ${"A".repeat(42)}`,
      `${"A".repeat(42)}\n`,
      "Ä".repeat(43),
    ]) {
      assert.equal(isWellFormedResetToken(token), false, JSON.stringify(token.slice(0, 50)));
    }
    for (const value of [null, undefined, 42, {}, ["A".repeat(43)], new Blob(["x"])]) {
      assert.equal(isWellFormedResetToken(value), false);
    }
  });
});

describe("newPasswordProblem", () => {
  it("accepts an ordinary password and its confirmation", () => {
    assert.equal(newPasswordProblem("correct horse", "correct horse"), null);
    assert.equal(newPasswordProblem("a".repeat(72), "a".repeat(72)), null, "exactly 72 bytes is fine");
    assert.equal(newPasswordProblem("😀".repeat(18), "😀".repeat(18)), null, "18 emoji are 72 bytes");
  });

  it("names the field each problem is about", () => {
    assert.deepEqual(newPasswordProblem("short", "short"), {
      field: "password",
      error: "Password must be at least 8 characters.",
    });
    assert.equal(newPasswordProblem("a".repeat(73), "a".repeat(73))?.field, "password");
    assert.equal(newPasswordProblem("correct horse", "correct house")?.field, "confirmPassword");
  });

  it("refuses anything bcrypt would truncate, and never more than that", () => {
    for (const password of [
      "a".repeat(73),
      "é".repeat(37), // 74 bytes in 37 characters
      "😀".repeat(19), // 76 bytes
      `${"a".repeat(70)}\ud800`, // a lone surrogate counts 3 bytes
      "p".repeat(100_000),
    ]) {
      assert.match(newPasswordProblem(password, password)?.error ?? "", /too long/);
      assert.equal(bcrypt.truncates(password), true);
    }
  });

  it("counts bytes the way bcrypt does", () => {
    for (const value of ["", "abc", "é", "😀", "\ud800", "\udc00x", "a\u0000b", "日本語", "😀".repeat(18), `${"a".repeat(71)}é`]) {
      assert.equal(utf8ByteLength(value) > MAX_PASSWORD_BYTES, bcrypt.truncates(value), JSON.stringify(value));
    }
    assert.equal(utf8ByteLength("\ud800"), 3);
    assert.equal(utf8ByteLength("😀"), 4);
  });

  it("keeps the input cap above anything a reset can set", () => {
    assert.ok(MAX_PASSWORD_INPUT_LENGTH > MAX_PASSWORD_BYTES);
  });
});

describe("oversizePasswordProblem", () => {
  it("lets anything up to the cap through to the later checks", () => {
    const atCap = "p".repeat(MAX_PASSWORD_INPUT_LENGTH);
    for (const [password, confirm] of [["", ""], ["short", "other"], [atCap, atCap], ["p".repeat(100), atCap]]) {
      assert.equal(oversizePasswordProblem(password, confirm), null);
    }
  });

  it("says exactly what the full rules would say about the same input", () => {
    const huge = "p".repeat(MAX_PASSWORD_INPUT_LENGTH + 1);
    for (const [password, confirm] of [
      [huge, huge],
      [huge, "brand-new-password"],
      ["brand-new-password", huge],
      ["short", huge],
    ]) {
      const early = oversizePasswordProblem(password, confirm);
      assert.ok(early, "refused");
      // Whatever passes the minimum, the full rules agree word for word.
      if (password.length >= 8) assert.deepEqual(early, newPasswordProblem(password, confirm));
    }
    assert.equal(oversizePasswordProblem("short", huge)?.field, "confirmPassword");
  });
});
