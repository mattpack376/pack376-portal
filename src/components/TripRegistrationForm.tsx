"use client";

import { useState } from "react";
import { registerForTripAction } from "@/lib/actions/tripRegistration";

/**
 * Public registration form for a TripPage — no account required. Selecting
 * an affiliation reveals that org's payment instructions (admin-edited
 * content, not hardcoded) as an inline notice rather than a JS modal, since
 * this codebase has no existing dialog primitive and inline is simpler and
 * more robust across devices.
 */
export default function TripRegistrationForm({
  tripPageId,
  currentPriceCents,
  packPaymentInstructions,
  troopPaymentInstructions,
}: {
  tripPageId: string;
  currentPriceCents: number;
  packPaymentInstructions: string | null;
  troopPaymentInstructions: string | null;
}) {
  const [affiliation, setAffiliation] = useState("");
  const [payingCount, setPayingCount] = useState(1);
  const [freeCount, setFreeCount] = useState(0);

  const totalCents = payingCount * currentPriceCents;
  const notice = affiliation === "PACK" ? packPaymentInstructions : affiliation === "TROOP" ? troopPaymentInstructions : null;

  return (
    <form action={registerForTripAction}>
      <input type="hidden" name="tripPageId" value={tripPageId} />
      <div style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">
        <label htmlFor="website">Leave this field blank</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="form-field">
        <label htmlFor="familyName">Family / Registrant Name</label>
        <input id="familyName" name="familyName" required placeholder="e.g. The Smith Family" />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="contactEmail">Email</label>
          <input id="contactEmail" name="contactEmail" type="email" required />
        </div>
        <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="contactPhone">Phone</label>
          <input id="contactPhone" name="contactPhone" type="tel" required />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="affiliation">Affiliated With</label>
        <select id="affiliation" name="affiliation" required value={affiliation} onChange={(e) => setAffiliation(e.target.value)}>
          <option value="" disabled>Select one…</option>
          <option value="PACK">Pack 376</option>
          <option value="TROOP">Troop 376</option>
        </select>
      </div>

      {notice && (
        <div className="info-card" style={{ background: "var(--cream)", marginBottom: 16, padding: "12px 16px" }}>
          <p style={{ margin: 0, fontWeight: 700 }}>{affiliation === "PACK" ? "Pack 376" : "Troop 376"} Payment Instructions</p>
          <p style={{ margin: "4px 0 0" }}>{notice}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="payingCount">Attendees (paying)</label>
          <input
            id="payingCount"
            name="payingCount"
            type="number"
            min="0"
            step="1"
            required
            value={payingCount}
            onChange={(e) => setPayingCount(Number(e.target.value) || 0)}
          />
        </div>
        <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="freeCount">Attendees (4 &amp; under, free)</label>
          <input
            id="freeCount"
            name="freeCount"
            type="number"
            min="0"
            step="1"
            required
            value={freeCount}
            onChange={(e) => setFreeCount(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <p className="form-note" style={{ fontSize: 15, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
        Total due: {(totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}
      </p>

      <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
        Register
      </button>
    </form>
  );
}
