import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * The current top-of-homepage banner. Prefers an active, pre-scheduled banner
 * (one with a startAt and/or endAt) that is currently within its window —
 * these are urgent, time-boxed notices. If none is currently in-window, falls
 * back to an active "default" banner (no startAt and no endAt), for a
 * standing message with nothing urgent to override it.
 */
export async function getActiveSiteBanner() {
  const now = new Date();

  const scheduled = await prisma.siteBanner.findFirst({
    where: {
      active: true,
      OR: [{ startAt: { not: null } }, { endAt: { not: null } }],
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (scheduled) return scheduled;

  return prisma.siteBanner.findFirst({
    where: { active: true, startAt: null, endAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** Every banner, for the admin editor. */
export async function getAllSiteBanners() {
  return prisma.siteBanner.findMany({ orderBy: { createdAt: "desc" } });
}
