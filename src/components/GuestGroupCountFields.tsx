"use client";

import { useState } from "react";

/** Adults/Kids/Amount Owed fields for a guest group — Amount Owed auto-fills from the counts times the event's per-head fees, and stays editable afterward (recalculated whenever a count changes). */
export default function GuestGroupCountFields({
  idPrefix,
  adultFeeCents,
  guestChildFeeCents,
  defaultAdultCount = 0,
  defaultChildCount = 0,
  defaultAmountOwedCents,
}: {
  idPrefix: string;
  adultFeeCents: number | null;
  guestChildFeeCents: number | null;
  defaultAdultCount?: number;
  defaultChildCount?: number;
  defaultAmountOwedCents?: number;
}) {
  const [adultCount, setAdultCount] = useState(defaultAdultCount);
  const [childCount, setChildCount] = useState(defaultChildCount);
  const [amount, setAmount] = useState(
    defaultAmountOwedCents !== undefined
      ? (defaultAmountOwedCents / 100).toFixed(2)
      : (
          (defaultAdultCount * (adultFeeCents ?? 0) + defaultChildCount * (guestChildFeeCents ?? 0)) /
          100
        ).toFixed(2),
  );

  function recompute(nextAdultCount: number, nextChildCount: number) {
    const cents = nextAdultCount * (adultFeeCents ?? 0) + nextChildCount * (guestChildFeeCents ?? 0);
    setAmount((cents / 100).toFixed(2));
  }

  return (
    <>
      <div className="form-row">
        <div className="form-field" style={{ flex: 1, minWidth: 120 }}>
          <label htmlFor={`${idPrefix}-adultCount`}>Adults</label>
          <input
            id={`${idPrefix}-adultCount`}
            name="adultCount"
            type="number"
            min="0"
            step="1"
            value={adultCount}
            onChange={(e) => {
              const next = Number(e.target.value) || 0;
              setAdultCount(next);
              recompute(next, childCount);
            }}
          />
        </div>
        <div className="form-field" style={{ flex: 1, minWidth: 120 }}>
          <label htmlFor={`${idPrefix}-childCount`}>Kids</label>
          <input
            id={`${idPrefix}-childCount`}
            name="childCount"
            type="number"
            min="0"
            step="1"
            value={childCount}
            onChange={(e) => {
              const next = Number(e.target.value) || 0;
              setChildCount(next);
              recompute(adultCount, next);
            }}
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
          Auto-filled from the counts above ({adultFeeCents !== null ? `$${(adultFeeCents / 100).toFixed(2)}/adult` : "no adult fee set"},{" "}
          {guestChildFeeCents !== null ? `$${(guestChildFeeCents / 100).toFixed(2)}/kid` : "no kid fee set"}) — edit freely.
        </p>
      </div>
    </>
  );
}
