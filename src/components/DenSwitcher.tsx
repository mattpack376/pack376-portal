import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { denDisplayName } from "@/lib/rankConfig";

/** Tab row for leaders assigned to more than one den — hidden entirely for single-den logins. */
export default async function DenSwitcher({
  denIds,
  currentDenId,
  basePath,
}: {
  denIds: string[];
  currentDenId: string;
  basePath: string;
}) {
  if (denIds.length <= 1) return null;

  const dens = await prisma.den.findMany({ where: { id: { in: denIds } } });
  const ordered = denIds
    .map((id) => dens.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d);

  return (
    <div className="attendance-jump-links">
      {ordered.map((den) => (
        <Link
          key={den.id}
          href={`${basePath}?denId=${den.id}`}
          className={den.id === currentDenId ? "active" : undefined}
        >
          {denDisplayName(den.rank, den.scoutingYear, den.label)}
        </Link>
      ))}
    </div>
  );
}
