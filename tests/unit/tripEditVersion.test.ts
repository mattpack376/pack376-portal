/*
 * The fingerprints the event admin page's Price Structure and registration
 * edit forms carry of what they were filled in with (tripEditVersion.ts): the
 * same values always give the same one, and a change to anything the form
 * edits gives another, so a save from a form loaded before that change is
 * turned down. (The refusals themselves are tested against Postgres in
 * tests/db/tripPricing.test.ts and tripRegistration.test.ts.)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tripPricingVersion, tripRegistrationEditVersion } from "@/lib/tripEditVersion";

/** Every variant's fingerprint differs from the base one, and from each other's. */
function assertAllDistinct<T>(fingerprint: (value: T) => string, base: T, changes: Partial<T>[]) {
  const seen = new Map([[fingerprint(base), "the base values"]]);
  for (const change of changes) {
    const version = fingerprint({ ...base, ...change });
    const label = JSON.stringify(change);
    assert.ok(!seen.has(version), `${label} has the same fingerprint as ${seen.get(version)}`);
    seen.set(version, label);
  }
}

describe("the Price Structure form's fingerprint", () => {
  type Pricing = Parameters<typeof tripPricingVersion>[0];
  const pricing: Pricing = {
    priceTbd: true,
    regularPriceCents: 0,
    earlyBirdPriceCents: null,
    earlyBirdDeadline: null,
    rsvpDeadline: null,
    freeAgeAndUnder: null,
  };

  it("is the same for the same pricing, whatever else is on the row", () => {
    assert.equal(tripPricingVersion(pricing), tripPricingVersion({ ...pricing }));
    const row = { ...pricing, title: "Renamed", published: false, flyerUrl: "https://example.test/f.pdf" };
    assert.equal(tripPricingVersion(row), tripPricingVersion(pricing), "editing the event's details leaves an open pricing form usable");
  });

  it("changes when any pricing field changes", () => {
    assertAllDistinct(tripPricingVersion, pricing, [
      { priceTbd: false },
      { regularPriceCents: 4000 },
      { priceTbd: false, regularPriceCents: 4000 },
      { earlyBirdPriceCents: 3500 },
      { earlyBirdPriceCents: 0 },
      { earlyBirdDeadline: new Date("2027-03-01T00:00:00.000Z") },
      { rsvpDeadline: new Date("2027-03-01T00:00:00.000Z") },
      { rsvpDeadline: new Date("2027-04-01T00:00:00.000Z") },
      { freeAgeAndUnder: 4 },
      { freeAgeAndUnder: 0 },
    ]);
  });
});

describe("a registration edit form's fingerprint", () => {
  type Registration = Parameters<typeof tripRegistrationEditVersion>[0];
  const registration: Registration = {
    familyName: "The Smiths",
    contactEmail: "smiths@example.test",
    contactPhone: "(212)555-0100",
    guestOfName: "Timmy Smith",
    affiliation: "PACK",
    payingCount: 2,
    freeCount: 0,
    amountOwedCents: 8000,
    owedPending: false,
  };

  it("is the same for the same registration, whatever else is on the row", () => {
    const row = { ...registration, id: "reg1", createdAt: new Date(), payments: [{ amountCents: 2000 }] };
    assert.equal(tripRegistrationEditVersion(row), tripRegistrationEditVersion(registration), "a payment leaves an open edit form usable");
  });

  it("changes when anything the form edits changes, the amount owed above all", () => {
    assertAllDistinct(tripRegistrationEditVersion, registration, [
      { amountOwedCents: 6000 },
      { amountOwedCents: 0 },
      { amountOwedCents: 0, owedPending: true },
      { familyName: "The Smith Family" },
      { contactEmail: "smith@example.test" },
      { contactPhone: "(212)555-0199" },
      { contactPhone: null },
      { guestOfName: "Tommy Smith" },
      { affiliation: "TROOP" },
      { payingCount: 3 },
      { freeCount: 1 },
    ]);
  });

  it("isn't fooled by values that run together", () => {
    // Fields are kept apart, not concatenated: "A" + "BC" isn't "AB" + "C".
    assert.notEqual(
      tripRegistrationEditVersion({ ...registration, familyName: "A", contactEmail: "BC" }),
      tripRegistrationEditVersion({ ...registration, familyName: "AB", contactEmail: "C" }),
    );
  });
});
