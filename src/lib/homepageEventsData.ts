import "server-only";
import { prisma } from "@/lib/prisma";

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Homepage "Upcoming Attractions" ticket list — past events drop off on their own. */
export async function getUpcomingHomepageEvents() {
  return prisma.homepageEvent.findMany({
    where: { sortDate: { gte: todayUtc() } },
    orderBy: { sortDate: "asc" },
  });
}

/** Every homepage event, past and future, for the admin editor. */
export async function getAllHomepageEvents() {
  return prisma.homepageEvent.findMany({ orderBy: { sortDate: "asc" } });
}
