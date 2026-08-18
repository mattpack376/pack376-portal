"use client";

import { useState } from "react";

/** Paying/free count + Amount Owed fields for editing a trip registration — Amount Owed auto-fills from paying count × the trip's current per-person price, and stays editable afterward (recalculated whenever the paying count changes). */
export default function TripRegistrationCountFields({
  idPrefix,
  pricePerPersonCents,
  defaultPayingCount,
  defaultFreeCount,
  defaultAmountOwedCents,
}: {
  idPrefix: string;
  pricePerPersonCents: number;
  defaultPayingCount: number;
  defaultFreeCount: number;
  defaultAmountOwedCents: number;
}) {
  // Kept as strings (not numbers) so the field can go genuinely empty while
  // typing on mobile — type="number" inputs don't support .select()/select-
  // on-focus in any major mobile browser, so overwriting a pre-filled value
  // required deleting it first; a plain text input with a numeric keypad
  // (inputMode) does support selection, letting a tap-and-type replace it.
  const [payingCount, setPayingCount] = useState(String(defaultPayingCount));
  const [freeCount, setFreeCount] = useState(String(defaultFreeCount));
  const [amount, setAmount] = useState((defaultAmountOwedCents / 100).toFixed(2));

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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
              setAmount(((Number(next || 0) * pricePerPersonCents) / 100).toFixed(2));
            }}
            onFocus={(e) => e.target.select()}
          />
        </div>
        <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor={`${idPrefix}-freeCount`}>Attendees (4 &amp; under, free)</label>
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
      </div>
      <div className="form-field" style={{ maxWidth: 160 }}>
        <label htmlFor={`${idPrefix}-amountOwed`}>Amount Owed ($)</label>
        <input
          id={`${idPrefix}-amountOwed`}
          name="amountOwed"
          type="number"
          min="0"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <p className="form-note" style={{ marginTop: 4, marginBottom: 0 }}>
          Auto-filled from paying count × the current price (${(pricePerPersonCents / 100).toFixed(2)}/person) — edit freely.
        </p>
      </div>
    </>
  );
}
