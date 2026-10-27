import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entryEditVersion, paymentEditVersion } from "@/lib/raffleEditVersion";

describe("Edit form fingerprints", () => {
  type LoadedPayment = Parameters<typeof paymentEditVersion>[0];
  const payment: LoadedPayment = {
    entryId: "entry1",
    amountCents: 1000,
    method: "CASH",
    payerName: null,
    receivedOn: new Date("2026-10-11T00:00:00.000Z"),
    note: null,
  };

  it("are the same for the same values, whatever else is on the row", () => {
    assert.equal(paymentEditVersion(payment), paymentEditVersion({ ...payment }));
    const verifiedRow = { ...payment, verifiedAt: new Date(), verifiedByName: "Admin" };
    assert.equal(paymentEditVersion(payment), paymentEditVersion(verifiedRow), "verifying a payment doesn't make an open Edit form stale");
    assert.equal(entryEditVersion({ name: "Ann", notes: null }), entryEditVersion({ name: "Ann", notes: null }));
  });

  it("change when any field the form edits changes", () => {
    const base = paymentEditVersion(payment);
    const changes: Partial<LoadedPayment>[] = [
      { entryId: "entry2" },
      { entryId: null },
      { amountCents: 1500 },
      { method: "ZELLE" },
      { payerName: "Frank" },
      { receivedOn: new Date("2026-10-12T00:00:00.000Z") },
      { receivedOn: null },
      { note: "x" },
      { note: "" },
    ];
    const versions = new Set([base]);
    for (const change of changes) {
      const version = paymentEditVersion({ ...payment, ...change });
      assert.notEqual(version, base, JSON.stringify(change));
      versions.add(version);
    }
    assert.equal(versions.size, changes.length + 1, "no two of them collide");

    const entry = entryEditVersion({ name: "Ann", notes: null });
    assert.notEqual(entryEditVersion({ name: "Ann Lee", notes: null }), entry);
    assert.notEqual(entryEditVersion({ name: "Ann", notes: "" }), entry);
    assert.notEqual(entryEditVersion({ name: "ann", notes: null }), entry);
  });
});
