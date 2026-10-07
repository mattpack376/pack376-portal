import type { CSSProperties } from "react";
import { formatCents } from "@/lib/duesData";
import type { getTripRegistrations } from "@/lib/tripPageData";

/**
 * One unit's (Pack 376 or Troop 376) Camp Conron totals: families and
 * headcount, how many are paid in full, and owed/paid/remaining. Shown on
 * the admin page for both units side by side, and on the read-only view
 * above each unit's family list. Pass only that unit's registrations.
 */
export default function TripAffiliationSummary({
  name,
  registrations,
  style,
}: {
  name: string;
  registrations: Awaited<ReturnType<typeof getTripRegistrations>>;
  style?: CSSProperties;
}) {
  const adults = registrations.reduce((sum, r) => sum + r.payingCount, 0);
  const kids = registrations.reduce((sum, r) => sum + r.freeCount, 0);
  const owed = registrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const paid = registrations.reduce((sum, r) => sum + r.paidCents, 0);
  const paidInFull = registrations.filter((r) => r.remainingCents <= 0).length;
  // Every mixed text/value line is built as one plain string (not
  // interleaved JSX text/expression children) because this toolchain's JSX
  // transform was observed dropping the space that immediately follows a
  // `{expr}` boundary when that boundary is followed directly by more
  // literal text on the same line — reproducible and confirmed via the
  // rendered DOM's child nodes, not a typo in the source.
  const summaryHeading = `${name} Summary`;
  const familiesSummary = `${registrations.length} famil${registrations.length === 1 ? "y" : "ies"} — ${adults} adult${
    adults === 1 ? "" : "s"
  }, ${kids} kid${kids === 1 ? "" : "s"} (4 and under)`;
  const paidInFullSummary = `${paidInFull} of ${registrations.length} paid in full`;
  const moneySummary = `Owed ${formatCents(owed)} · Paid ${formatCents(paid)} · Remaining ${formatCents(owed - paid)}`;

  return (
    <div className="info-card" style={style}>
      <h3>{summaryHeading}</h3>
      <p style={{ marginBottom: 8 }}>{familiesSummary}</p>
      <p style={{ marginBottom: 8 }}>{paidInFullSummary}</p>
      <p>{moneySummary}</p>
    </div>
  );
}
