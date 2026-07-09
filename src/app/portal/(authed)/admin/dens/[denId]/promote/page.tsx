import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { denDisplayName, nextRank, RANK_INFO } from "@/lib/rankConfig";
import PromoteDenForm from "@/components/PromoteDenForm";

function suggestNextYear(scoutingYear: string) {
  const match = scoutingYear.match(/(\d{4})\D+(\d{4})/);
  if (!match) return scoutingYear;
  const start = parseInt(match[1], 10) + 1;
  const end = parseInt(match[2], 10) + 1;
  return `${start}-${end}`;
}

export default async function PromoteDenPage({
  params,
}: {
  params: Promise<{ denId: string }>;
}) {
  const { denId } = await params;
  const den = await prisma.den.findUnique({ where: { id: denId } });
  if (!den) notFound();

  const next = nextRank(den.rank);
  if (!next) redirect(`/portal/admin/dens/${denId}`);

  const suggestedYear = suggestNextYear(den.scoutingYear);
  const suggestedUsername = `${next.toLowerCase()}${suggestedYear.slice(0, 4)}`;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Promote Den</div>
        <h2>Move This Den Up a Rank</h2>
      </div>
      <PromoteDenForm
        denId={den.id}
        fromLabel={denDisplayName(den.rank, den.scoutingYear, den.label)}
        toLabel={`${RANK_INFO[next].label} — ${suggestedYear}`}
        suggestedYear={suggestedYear}
        suggestedUsername={suggestedUsername}
      />
    </>
  );
}
