import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Deletes a scout and cascades to its Parent rows at the DB level, which
 * bypasses removeParentAction's sessionVersion bump — done here instead so
 * an already-issued parent session can't keep seeing this scout's data for
 * the rest of its 45-day life. Shared by the den roster's Remove action and
 * the admin Users → Scouts screen's Delete button.
 */
export async function deleteScoutCascade(scoutId: string) {
  const linkedParents = await prisma.parent.findMany({
    where: { scoutId, userId: { not: null } },
    select: { userId: true },
  });
  const linkedUserIds = [...new Set(linkedParents.map((p) => p.userId!))];

  await prisma.$transaction([
    prisma.scout.delete({ where: { id: scoutId } }),
    ...linkedUserIds.map((userId) =>
      prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } })
    ),
  ]);
}
