import Link from "next/link";
import type { ChecklistScout } from "@/lib/denData";

/**
 * The den's rank badges at a glance, above the scout cards: how many are
 * awarded, earned but not yet handed out (linking to Pending Awards for this
 * den's rank badges), and still in progress. Counts come from each card's
 * server-side rank status, so they match Pending Awards and the audit page.
 */
export default function DenRankSummary({ scouts, denId }: { scouts: ChecklistScout[]; denId: string }) {
  const withStatus = scouts.flatMap((s) => (s.rankStatus ? [s.rankStatus] : []));
  if (withStatus.length === 0) return null;
  const label = withStatus[0].rankLabel;
  const awarded = withStatus.filter((r) => r.award).length;
  const earned = withStatus.filter((r) => !r.award && r.progress.earned).length;
  const inProgress = withStatus.length - awarded - earned;

  return (
    <div className="rank-summary" aria-label={`${label} rank badges`}>
      <strong>{label} rank badge:</strong>
      <span className="rank-badge-chip is-awarded">{awarded} awarded</span>
      {earned > 0 ? (
        <Link className="rank-badge-chip" href={`/portal/awards?denId=${denId}&type=ranks`}>
          {earned} earned — not yet awarded
        </Link>
      ) : (
        <span className="rank-badge-chip">0 earned — not yet awarded</span>
      )}
      <span className="rank-badge-chip">{inProgress} in progress</span>
    </div>
  );
}
