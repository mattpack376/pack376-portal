import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buyerNameKey } from "@/lib/raffleMath";

describe("buyerNameKey", () => {
  it("ignores capitals, accented ones included, and spaces at either end", () => {
    assert.equal(buyerNameKey("  Frank SMITH "), "frank smith");
    assert.equal(buyerNameKey("JOSÉ DÍAZ"), buyerNameKey("José Díaz"));
    assert.equal(buyerNameKey("ÁNGEL NÚÑEZ"), "ángel núñez");
  });

  it("treats an accent typed as a separate mark like the accented letter", () => {
    assert.equal(buyerNameKey("José"), buyerNameKey("José"));
    assert.equal(buyerNameKey("JOSÉ"), "josé");
  });

  it("keeps everything else that tells two people apart", () => {
    assert.notEqual(buyerNameKey("Frank Smith"), buyerNameKey("Frank S."));
    assert.notEqual(buyerNameKey("Jose Diaz"), buyerNameKey("José Díaz"), "an accent is part of the name");
    assert.notEqual(buyerNameKey("Frank  Smith"), buyerNameKey("Frank Smith"), "inside spaces are kept, as the board shows them");
    // Plain characters, not a pattern.
    assert.notEqual(buyerNameKey("Fr%"), buyerNameKey("Frank"));
    assert.notEqual(buyerNameKey("Fr_nk"), buyerNameKey("Frank"));
  });
});
