"use client";

import { useState } from "react";

/** Paying/free count + Amount Owed fields for editing a trip registration — Amount Owed auto-fills from paying count × the trip's current per-person price, and stays editable afterward (recalculated whenever the paying count changes). */
export default function TripRegistrationCountFields({
  idPrefix,
  pricePerPersonCents,
  defaultPayingCount,
  defaultFreeCount,
  defaultAmountOwedCents,
  owedPending,
  priceTbd,
  freeAgeAndUnder,
}: {
  idPrefix: string;
  pricePerPersonCents: number;
  defaultPayingCount: number;
  defaultFreeCount: number;
  defaultAmountOwedCents: number;
  /** Registered while the price was TBD: the amount is left blank (and stays pending) until the price is posted or one is typed here. */
  owedPending: boolean;
  /**
   * Whether the trip's price is still TBD. A registration still pending on a
   * trip whose price is posted (left behind by a race before posting took the
   * trip's lock) has its blank amount charged at attendees × the price on save.
   */
  priceTbd: boolean;
  /** The event's free age; null when it has no free tier (the free field then only shows for a registration that already has free attendees). */
  freeAgeAndUnder: number | null;
}) {
  // Kept as strings (not numbers) so the field can go genuinely empty while
  // typing on mobile — type="number" inputs don't support .select()/select-
  // on-focus in any major mobile browser, so overwriting a pre-filled value
  // required deleting it first; a plain text input with a numeric keypad
  // (inputMode) does support selection, letting a tap-and-type replace it.
  const [payingCount, setPayingCount] = useState(String(defaultPayingCount));
  const [freeCount, setFreeCount] = useState(String(defaultFreeCount));
  const [amount, setAmount] = useState(owedPending ? "" : (defaultAmountOwedCents / 100).toFixed(2));
  const showFree = freeAgeAndUnder !== null || defaultFreeCount > 0;
  const uncharged = owedPending && !priceTbd;
  const chargeText = `$${((Number(payingCount || 0) * pricePerPersonCents) / 100).toFixed(2)}`;

  return (
    <>
      <div className="form-row">
        <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor={`${idPrefix}-payingCount`}>Attendees (paying)</label>
          <input
            id={`${idPrefix}-payingCount`}
            name="payingCount"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            value={payingCount}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "");
              setPayingCount(next);
              // Nothing to multiply by while the price is unreleased.
              if (!owedPending) setAmount(((Number(next || 0) * pricePerPersonCents) / 100).toFixed(2));
            }}
            onFocus={(e) => e.target.select()}
          />
        </div>
        {showFree ? (
          <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor={`${idPrefix}-freeCount`}>
              {freeAgeAndUnder === null ? "Attendees (free)" : `Attendees (${freeAgeAndUnder} & under, free)`}
            </label>
            <input
              id={`${idPrefix}-freeCount`}
              name="freeCount"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              value={freeCount}
              onChange={(e) => setFreeCount(e.target.value.replace(/\D/g, ""))}
              onFocus={(e) => e.target.select()}
            />
          </div>
        ) : (
          <input type="hidden" name="freeCount" value="0" />
        )}
      </div>
      <div className="form-field" style={{ maxWidth: 160 }}>
        <label htmlFor={`${idPrefix}-amountOwed`}>Amount Owed ($)</label>
        <input
          id={`${idPrefix}-amountOwed`}
          name="amountOwed"
          type="number"
          min="0"
          step="0.01"
          required={!owedPending}
          placeholder={uncharged ? chargeText : owedPending ? "Pending price" : undefined}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p className="form-note" style={{ marginTop: 4, marginBottom: 0 }}>
          {uncharged
            ? `Not charged yet. Leave blank to charge paying count × the posted price ($${(pricePerPersonCents / 100).toFixed(2)}/person = ${chargeText}), or type an amount.`
            : owedPending
              ? "Waiting for the price — it fills in (attendees × price) when you post it. Type an amount to set it now."
              : `Auto-filled from paying count × the current price ($${(pricePerPersonCents / 100).toFixed(2)}/person) — edit freely.`}
        </p>
      </div>
    </>
  );
}
