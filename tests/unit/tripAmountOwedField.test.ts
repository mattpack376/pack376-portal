/*
 * The admin edit form's Amount Owed field and the paying count beside it: the
 * amount only moves with the count while it is count × today's price, so a
 * family charged at another rate — or an amount typed while the price is
 * TBD — is never quietly repriced by a count correction. The rule is checked
 * as plain functions, and the form's server render for the notes it shows.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { amountAfterCountChange, amountFieldText, amountFollowsCount } from "@/lib/tripAmountOwedField";
import TripRegistrationCountFields from "@/components/TripRegistrationCountFields";

const change = (amount: string, previousCount: number, nextCount: number, pricePerPersonCents: number, priceTbd = false) =>
  amountAfterCountChange({ amount, previousCount, nextCount, pricePerPersonCents, priceTbd });

describe("the Amount Owed field as the paying count changes", () => {
  it("follows the count while the amount is count × today's price", () => {
    assert.equal(change("110.00", 2, 3, 5500), "165.00");
    assert.equal(change("110", 2, 3, 5500), "165.00", "however the amount is written");
    assert.equal(change("0.00", 0, 4, 5500), "220.00", "a cleared count starts over from $0");
    assert.equal(change("165.00", 3, 0, 5500), "0.00");
    // Keystroke by keystroke: "1" then "12" stays linked all the way.
    assert.equal(change(change("55.00", 1, 1, 5500), 1, 12, 5500), "660.00");
  });

  it("leaves an amount charged at another rate alone (an early-bird family after the deadline)", () => {
    // Charged 2 × $45; today's price is $55.
    assert.equal(change("90.00", 2, 3, 5500), "90.00");
    assert.equal(amountFollowsCount("90.00", 2, 5500, false), false);
  });

  it("leaves an amount the admin typed alone", () => {
    assert.equal(change("100.00", 2, 3, 5500), "100.00");
    // Typing the matching total links it again.
    assert.equal(amountFollowsCount("165.00", 3, 5500, false), true);
  });

  it("never touches the amount while the price is TBD", () => {
    // The Cyclones case: an admin typed $80 on a TBD trip whose placeholder price is $0.
    assert.equal(change("80.00", 2, 3, 0, true), "80.00");
    // Even one that happens to equal count × the unposted price.
    assert.equal(change("0.00", 2, 3, 0, true), "0.00");
    assert.equal(change("80.00", 2, 3, 4000, true), "80.00");
    assert.equal(amountFollowsCount("0.00", 2, 0, true), false);
  });

  it("keeps a blank amount (still waiting for a price) blank, and anything unreadable as it is", () => {
    assert.equal(change("", 2, 3, 5500), "");
    assert.equal(change("abc", 2, 3, 5500), "abc");
    assert.equal(change("-110.00", 2, 3, 5500), "-110.00");
  });

  it("a free event stays at $0", () => {
    assert.equal(change("0.00", 2, 5, 0), "0.00");
  });

  it("writes amounts the way the field shows them", () => {
    assert.equal(amountFieldText(0), "0.00");
    assert.equal(amountFieldText(12345), "123.45");
  });
});

describe("TripRegistrationCountFields", () => {
  const render = (props: Partial<Parameters<typeof TripRegistrationCountFields>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(TripRegistrationCountFields, {
        idPrefix: "reg-1",
        pricePerPersonCents: 5500,
        defaultPayingCount: 2,
        defaultFreeCount: 0,
        defaultAmountOwedCents: 11000,
        owedPending: false,
        priceTbd: false,
        freeAgeAndUnder: null,
        ...props,
      }),
    );

  it("says an amount at today's price follows the count", () => {
    const html = render();
    assert.match(html, /value="110.00"/);
    assert.match(html, /follows the paying count until you type a different amount/);
    assert.match(html, /aria-describedby="reg-1-amountOwed-note"/);
    assert.match(html, /id="reg-1-amountOwed-note"/);
  });

  it("says an amount set at another rate stays, and what today's price would come to", () => {
    const html = render({ defaultAmountOwedCents: 9000 });
    assert.match(html, /value="90.00"/);
    assert.match(html, /stays as it is when the paying count changes/);
    assert.match(html, /At today&#x27;s price \(\$55\.00\/person\), 2 paying would be \$110\.00/);
  });

  it("says an amount on a TBD trip doesn't change with the count", () => {
    const html = render({ priceTbd: true, pricePerPersonCents: 0, defaultAmountOwedCents: 8000 });
    assert.match(html, /value="80.00"/);
    assert.match(html, /The price isn&#x27;t posted yet, so this amount stays as it is/);
  });
});
